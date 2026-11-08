# Vendored from OpenMuse (https://github.com/DominiqueMakowski/OpenMuse, MIT License),
# OpenMuse/decode.py at commit a9be252: only the message parser, without make_timestamps and
# decode_rawdata (and so without pandas). Used to decode the Muse S Athena's Bluetooth packets
# that the browser forwards over Web Bluetooth. Don't edit by hand; re-copy from upstream.
"""
Muse BLE Message Parser
============================================

Implementation that follows the actual message structure:
MESSAGE → PACKET → DATA SUBPACKETS

Message Structure:
------------------
Each BLE MESSAGE contains one or more PACKETS. Each PACKET has a 14-byte header
followed by a data section containing multiple DATA SUBPACKETS:

MESSAGE (BLE transmission with timestamp)
  └─ PACKET (14-byte header + data section)
       ├─ First Subpacket: Raw sensor data (no TAG, no header)
       └─ Additional Subpackets: [TAG (1 byte)][Header (4 bytes)][Data (variable)]
            ├─ TAG: Sensor type identifier (e.g., 0x47=ACCGYRO, 0x12=EEG8)
            ├─ subpkt_index: Per-sensor-type sequence counter (0-255, wraps)
            ├─ Unknown bytes: 3 metadata bytes (purpose unknown)
            └─ Sensor data: Variable length depending on sensor type

Timestamp Calculation & Device Timing:
---------------------------------------
Device timestamps (pkt_time) are derived from a 256 kHz hardware clock with 3.906 µs resolution.
Multiple packets often share identical pkt_time values (~99% of packets are in duplicate groups).

Timestamp generation per message:
  1. Sort packets by (pkt_time, pkt_index, subpkt_index)
     - pkt_index: Packet sequence counter (0-255), ensures correct ordering of duplicates
     - Analysis: pkt_index provides 100% correct temporal ORDERING within duplicate groups,
       though indices may have gaps (not strictly consecutive, as some packets arrive with
       different timestamps). The arrival order always matches pkt_index order.
  2. Use first packet's pkt_time as anchor
  3. Generate uniform timestamps: anchor + (sample_index / sampling_rate)

Hardware Timing Artifacts:
  - ~3-4% of pkt_time values have timing inversions (timestamps go backwards)
  - pkt_index provides correct ordering (100% accurate for packet sequencing)
  - Inversions likely due to async sensor buffering and clock jitter
  - Final monotonicity ensured by stream.py buffering/sorting before LSL output

"""

import struct
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Union
from datetime import datetime
import numpy as np


# Protocol constants
PACKET_HEADER_SIZE = 14  # Size of packet header in bytes
SUBPACKET_HEADER_SIZE = 5  # Size of subpacket header (TAG + 4 bytes)
DEVICE_CLOCK_HZ = 256000.0  # Device clock frequency: 256 kHz

# Sensor configuration mapping
# Maps TAG byte to sensor type, channels, samples, sampling rate, and data length
SENSORS = {
    0x11: {
        "type": "EEG",
        "n_channels": 4,
        "n_samples": 4,
        "rate": 256.0,
        "data_len": 28,
    },
    0x12: {
        "type": "EEG",
        "n_channels": 8,
        "n_samples": 2,
        "rate": 256.0,
        "data_len": 28,
    },
    0x34: {
        "type": "OPTICS",
        "n_channels": 4,
        "n_samples": 3,
        "rate": 64.0,
        "data_len": 30,
    },
    0x35: {
        "type": "OPTICS",
        "n_channels": 8,
        "n_samples": 2,
        "rate": 64.0,
        "data_len": 40,
    },
    0x36: {
        "type": "OPTICS",
        "n_channels": 16,
        "n_samples": 1,
        "rate": 64.0,
        "data_len": 40,
    },
    0x47: {
        "type": "ACCGYRO",
        "n_channels": 6,
        "n_samples": 3,
        "rate": 52.0,
        "data_len": 36,
    },
    0x53: {
        "type": "Unknown",
        "n_channels": 0,
        "n_samples": 0,
        "rate": 0.0,
        "data_len": 24,
    },
    # 0x88: New firmware battery/status packet
    # Contains battery percentage in first 2 bytes, plus additional unknown data
    # Battery is extracted from this packet for new firmware (replaces 0x98)
    # NOTE: data_len is set to minimum observed (196 bytes) but actual packets
    # vary from 188-230 bytes. The decoder only reads first 2 bytes for battery.
    0x88: {
        "type": "BATTERY",
        "n_channels": 1,
        "n_samples": 1,
        "rate": 0.2,  # ~1 packet every 5-6 seconds (variable)
        "data_len": 188,  # Minimum observed; actual packets vary 188-230 bytes
    },
    0x98: {
        "type": "BATTERY",
        "n_channels": 1,
        "n_samples": 1,
        "rate": 1.0,
        "data_len": 20,
    },
}

# Scaling constants
ACC_SCALE = 0.0000610352
GYRO_SCALE = -0.0074768
OPTICS_SCALE = 1.0 / 32768.0
EEG_SCALE = 1450.0 / 16383.0

# Standard channel label definitions shared across modules
EEG_CHANNELS = (
    "EEG_TP9",
    "EEG_AF7",
    "EEG_AF8",
    "EEG_TP10",
    "AUX_1",
    "AUX_2",
    "AUX_3",
    "AUX_4",
)

ACCGYRO_CHANNELS = (
    "ACC_X",
    "ACC_Y",
    "ACC_Z",
    "GYRO_X",
    "GYRO_Y",
    "GYRO_Z",
)

OPTICS_CHANNELS = (
    "OPTICS_LO_NIR",
    "OPTICS_RO_NIR",
    "OPTICS_LO_IR",
    "OPTICS_RO_IR",
    "OPTICS_LI_NIR",
    "OPTICS_RI_NIR",
    "OPTICS_LI_IR",
    "OPTICS_RI_IR",
    "OPTICS_LO_RED",
    "OPTICS_RO_RED",
    "OPTICS_LO_AMB",
    "OPTICS_RO_AMB",
    "OPTICS_LI_RED",
    "OPTICS_RI_RED",
    "OPTICS_LI_AMB",
    "OPTICS_RI_AMB",
)

BATTERY_CHANNELS = ("BATTERY_PERCENT",)


def select_eeg_channels(count: int) -> List[str]:
    if count <= len(EEG_CHANNELS):
        return list(EEG_CHANNELS[:count])
    return [f"EEG_{i+1:02d}" for i in range(count)]


_OPTICS_INDEXES = {
    4: (4, 5, 6, 7),
    8: tuple(range(8)),
    16: tuple(range(16)),
}


def select_optics_channels(count: int) -> List[str]:
    indices = _OPTICS_INDEXES.get(count)
    if indices is not None:
        return [OPTICS_CHANNELS[i] for i in indices]
    return [f"OPTICS_{i+1:02d}" for i in range(count)]


def parse_message(message: str) -> Dict[str, List[Dict]]:
    """
    Parse a BLE message into structured data.

    This parser follows the actual message structure:
    MESSAGE → PACKET (14-byte header) → DATA SUBPACKETS (TAG + 4-byte header + data)

    Parameters:
    -----------
    message : str
        Tab-separated string: timestamp, UUID, hex-encoded payload

    Returns:
    --------
    dict : Dictionary with sensor types as keys, lists of subpacket dicts as values
        Keys: "EEG", "ACCGYRO", "OPTICS", "BATTERY", "Unknown"
        Each list contains subpacket dictionaries with decoded sensor data
    """

    # Parse message line
    try:
        ts, uuid, hexstring = message.strip().split("\t", 2)
        message_time = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        payload = bytes.fromhex(hexstring.strip())
    except (ValueError, AttributeError):
        # Malformed message
        return _empty_result()

    # Initialize result dictionary for parsed subpackets
    parsed_data = _empty_result()

    # Step 1: Parse all packets in the message
    packets = _parse_packets(payload, message_time, uuid)

    # Step 2: Parse data subpackets within each packet
    for pkt in packets:
        subpackets = _parse_data_subpackets(pkt)

        # Step 3: Decode data for each subpacket
        for subpkt in subpackets:
            sensor_type = subpkt["sensor_type"]
            decoded = _decode_subpacket_data(subpkt)

            if decoded is not None:
                # Add packet-level metadata to decoded subpacket
                decoded.update(
                    {
                        "pkt_index": pkt["pkt_index"],
                        "pkt_time": pkt["pkt_time"],
                        "pkt_time_raw": pkt["pkt_time_raw"],
                        "message_time": pkt["message_time"],
                        "message_uuid": pkt["message_uuid"],
                    }
                )

                parsed_data[sensor_type].append(decoded)

    # Return raw subpackets for global timestamping
    return parsed_data


def _empty_result() -> Dict[str, List]:
    """Create empty result dictionary with all sensor types."""
    return {
        "EEG": [],
        "ACCGYRO": [],
        "OPTICS": [],
        "BATTERY": [],
        "Unknown": [],
    }


def _empty_result_arrays() -> Dict[str, np.ndarray]:
    """Create empty result dictionary with numpy arrays for all sensor types."""
    return {
        "EEG": np.empty((0, 0)),
        "ACCGYRO": np.empty((0, 0)),
        "OPTICS": np.empty((0, 0)),
        "BATTERY": np.empty((0, 0)),
        "Unknown": np.empty((0, 0)),
    }


def _parse_packets(payload: bytes, message_time: datetime, uuid: str) -> List[Dict]:
    """
    Parse all packets from payload based on declared length.

    Returns list of packet dicts with header information and data section.
    """
    packets = []
    offset = 0

    while offset < len(payload):
        # Need at least PACKET_HEADER_SIZE bytes for packet header
        if offset + PACKET_HEADER_SIZE > len(payload):
            break

        # Read declared packet length
        pkt_len = payload[offset]

        # Validate we have enough bytes
        if offset + pkt_len > len(payload):
            break

        # Extract full packet
        pkt_bytes = payload[offset : offset + pkt_len]

        # Parse packet header (PACKET_HEADER_SIZE bytes)
        pkt_index = pkt_bytes[1]
        pkt_time_raw = struct.unpack_from("<I", pkt_bytes, 2)[0]
        pkt_time = (
            pkt_time_raw / DEVICE_CLOCK_HZ
        )  # Convert device clock ticks to seconds
        pkt_unknown1 = pkt_bytes[6:9]
        pkt_id = pkt_bytes[9]
        pkt_unknown2 = pkt_bytes[10:13]
        byte_13 = pkt_bytes[13]

        # Decode pkt_id to get sensor type
        pkt_config = SENSORS.get(pkt_id)
        pkt_type = pkt_config["type"] if pkt_config else None

        # Validate packet
        # Note: byte_13 is NOT always 0 in newer firmware versions.
        # It appears to be a sequence counter or metadata field.
        # Removed byte_13 == 0 check for compatibility with new firmware.
        pkt_valid = (
            pkt_type is not None
            and pkt_len == len(pkt_bytes)
            and pkt_len >= PACKET_HEADER_SIZE
        )

        # Extract data section (everything after header)
        pkt_data = (
            pkt_bytes[PACKET_HEADER_SIZE:]
            if len(pkt_bytes) > PACKET_HEADER_SIZE
            else b""
        )

        packets.append(
            {
                "pkt_len": pkt_len,
                "pkt_index": pkt_index,
                "pkt_time": pkt_time,
                "pkt_time_raw": pkt_time_raw,
                "pkt_unknown1": pkt_unknown1,
                "pkt_id": pkt_id,
                "pkt_type": pkt_type,
                "pkt_unknown2": pkt_unknown2,
                "pkt_valid": pkt_valid,
                "pkt_data": pkt_data,
                "message_time": message_time,
                "message_uuid": uuid,
            }
        )

        offset += pkt_len

    return packets


def _parse_data_subpackets(pkt: Dict) -> List[Dict]:
    """
    Parse all data subpackets within a packet's data section.

    The packet data section contains:
    1. Primary data (sensor type matching pkt_type, NO TAG, NO 4-byte header, just raw data)
    2. Additional subpackets (each with [TAG][4-byte header][data])

    Returns list of subpacket dicts with raw bytes and metadata.
    """
    subpackets = []
    pkt_data = pkt["pkt_data"]
    offset = 0

    # Step 1: Parse first data subpacket (no TAG, no header, just raw sensor data)
    # This is always the sensor type indicated by the packet header
    if pkt["pkt_valid"] and pkt["pkt_type"] is not None:
        first_type = pkt["pkt_type"]
        # Get data length from SENSORS config using pkt_id as TAG
        first_data_len = SENSORS.get(pkt["pkt_id"], {}).get("data_len", 0)

        if first_data_len > 0 and offset + first_data_len <= len(pkt_data):
            # Extract first subpacket data bytes (no TAG, no header)
            first_data_bytes = pkt_data[offset : offset + first_data_len]

            # Add first subpacket (no index or unknown bytes available)
            subpackets.append(
                {
                    "sensor_type": first_type,
                    "tag_byte": pkt["pkt_id"],  # Use packet ID as tag for config lookup
                    "subpkt_index": None,  # First subpacket has no index in data section
                    "subpkt_unknown": None,  # First subpacket has no unknown bytes
                    "data_bytes": first_data_bytes,
                }
            )

            # Move offset past first data
            offset += first_data_len

    # Step 2: Parse all additional subpackets (each with TAG + 4-byte header + data)
    while offset < len(pkt_data):
        # Check if we have enough bytes for TAG + header
        if offset + SUBPACKET_HEADER_SIZE > len(pkt_data):
            break

        tag_byte = pkt_data[offset]

        # Validate TAG (must be a known sensor TAG)
        if tag_byte not in SENSORS:
            break

        sensor_type = SENSORS[tag_byte]["type"]

        # Parse 4-byte subpacket header
        subpkt_index = pkt_data[offset + 1]
        subpkt_unknown = pkt_data[offset + 2 : offset + SUBPACKET_HEADER_SIZE]

        # Get data length from SENSORS config
        data_len = SENSORS[tag_byte].get("data_len", 0)

        if data_len == 0:
            # Unknown data length, skip this TAG
            break

        # Check if we have enough bytes for full subpacket
        if offset + SUBPACKET_HEADER_SIZE + data_len > len(pkt_data):
            break

        # Extract data bytes
        data_bytes = pkt_data[
            offset + SUBPACKET_HEADER_SIZE : offset + SUBPACKET_HEADER_SIZE + data_len
        ]

        subpackets.append(
            {
                "sensor_type": sensor_type,
                "tag_byte": tag_byte,
                "subpkt_index": subpkt_index,
                "subpkt_unknown": subpkt_unknown,
                "data_bytes": data_bytes,
            }
        )

        # Move to next subpacket
        offset += SUBPACKET_HEADER_SIZE + data_len

    return subpackets


def _decode_subpacket_data(subpkt: Dict) -> Optional[Dict]:
    """
    Decode data bytes based on TAG byte configuration.

    Returns dict with:
        - data: np.ndarray with decoded values (no timestamps)
        - subpkt_index: index value (None for first subpacket)
        - subpkt_unknown: metadata bytes (None for first subpacket)
        - sensor_type: type string
        - n_channels: number of channels
        - n_samples: number of samples

    Returns None if sensor type is not decodable (e.g., "Unknown").
    """
    sensor_type = subpkt["sensor_type"]
    data_bytes = subpkt["data_bytes"]
    tag_byte = subpkt["tag_byte"]

    # Skip Unknown type (no decoder yet)
    if sensor_type == "Unknown":
        return None

    # Get configuration from TAG (cache lookup to avoid redundant dictionary access)
    config = SENSORS.get(tag_byte)
    if config is None:
        return None

    n_channels = config["n_channels"]
    n_samples = config["n_samples"]

    # Decode based on sensor type
    if sensor_type == "ACCGYRO":
        data = _decode_accgyro_data(data_bytes)
    elif sensor_type == "BATTERY":
        data = _decode_battery_data(data_bytes)
    elif sensor_type == "EEG":
        data = _decode_eeg_data(data_bytes, n_channels)
    elif sensor_type == "OPTICS":
        data = _decode_optics_data(data_bytes, n_channels)
    else:
        return None

    if data is None:
        return None

    return {
        "sensor_type": sensor_type,
        "tag_byte": tag_byte,  # Include tag_byte for timestamp calculation
        "subpkt_index": subpkt["subpkt_index"],
        "subpkt_unknown": subpkt["subpkt_unknown"],
        "data": data,
        "n_channels": n_channels,
        "n_samples": n_samples,
    }


def _decode_accgyro_data(data_bytes: bytes) -> Optional[np.ndarray]:
    """
    Decode ACCGYRO data (36 bytes → 3 samples × 6 channels).

    Returns: np.ndarray shape (3, 6) with columns [ACC_X, ACC_Y, ACC_Z, GYRO_X, GYRO_Y, GYRO_Z]
    """
    if len(data_bytes) < 36:
        return None

    # Parse 18 int16 values, reshape to 3 samples × 6 channels
    data = np.frombuffer(data_bytes[:36], dtype="<i2", count=18).reshape(3, 6)
    data = data.astype(np.float32)

    # Apply scaling
    data[:, 0:3] *= ACC_SCALE  # Accelerometer
    data[:, 3:6] *= GYRO_SCALE  # Gyroscope

    return data


def _decode_battery_data(data_bytes: bytes) -> Optional[np.ndarray]:
    """
    Decode Battery data (first 2 bytes = SOC).

    Works for both:
    - 0x98 packets (old firmware): ~20 bytes, battery in first 2 bytes
    - 0x88 packets (new firmware): 188-230 bytes, battery in first 2 bytes

    Returns: np.ndarray shape (1,) with battery percentage
    """
    if len(data_bytes) < 2:
        return None

    raw_soc = struct.unpack("<H", data_bytes[0:2])[0]
    battery_percent = raw_soc / 256.0

    return np.array([battery_percent], dtype=np.float32)


def _bytes_to_bits(data_bytes: bytes, n_bytes: int) -> List[int]:
    """
    Convert bytes to bit array (LSB first).

    Parameters:
    -----------
    data_bytes : bytes
        Input bytes to convert
    n_bytes : int
        Number of bytes to process

    Returns:
    --------
    list[int] : List of bits (0 or 1), LSB first
    """
    bits = []
    for byte in data_bytes[:n_bytes]:
        for bit_pos in range(8):
            bits.append((byte >> bit_pos) & 1)
    return bits


def _extract_packed_int(bits: List[int], bit_start: int, bit_width: int) -> int:
    """
    Extract an integer from a bit array.

    Parameters:
    -----------
    bits : list[int]
        Bit array (0 or 1 values)
    bit_start : int
        Starting bit position
    bit_width : int
        Number of bits to extract

    Returns:
    --------
    int : Extracted integer value
    """
    int_value = 0
    for bit_idx in range(bit_width):
        if bits[bit_start + bit_idx]:
            int_value |= 1 << bit_idx
    return int_value


def _decode_eeg_data(data_bytes: bytes, n_channels: int) -> Optional[np.ndarray]:
    """
    Decode EEG data (14-bit packed values).

    EEG4: 4 samples × 4 channels = 28 bytes
    EEG8: 2 samples × 8 channels = 28 bytes

    Returns: np.ndarray shape (n_samples, n_channels)
    """
    if len(data_bytes) < 28:
        return None

    # Determine samples per packet
    n_samples = 4 if n_channels == 4 else 2

    # Convert bytes to bit array (LSB first)
    bits = _bytes_to_bits(data_bytes, 28)

    # Parse 14-bit values
    data = np.zeros((n_samples, n_channels), dtype=np.float32)

    for sample_idx in range(n_samples):
        for channel_idx in range(n_channels):
            bit_start = (sample_idx * n_channels + channel_idx) * 14

            # Extract 14 bits and scale to microvolts
            int_value = _extract_packed_int(bits, bit_start, 14)
            data[sample_idx, channel_idx] = int_value * EEG_SCALE

    return data


def _decode_optics_data(data_bytes: bytes, n_channels: int) -> Optional[np.ndarray]:
    """
    Decode Optics data (20-bit packed values).

    Sensor Positioning:
    -------------------
    Sensors are positioned as: Left Outer (LO) → Left Inner (LI) → Right Inner (RI) → Right Outer (RO)

    Signal Types:
    -------------
    - NIR: 730nm wavelength (near-infrared)
    - IR: 850nm wavelength (infrared)
    - RED: Red wavelength
    - AMB: Ambient light

    Channel Configurations:
    -----------------------
    Optics4:  3 samples × 4 channels = 30 bytes
              Channels: LI_NIR, RI_NIR, LI_IR, RI_IR (inner sensors only)

    Optics8:  2 samples × 8 channels = 40 bytes
              Channels: LO_NIR, RO_NIR, LO_IR, RO_IR, LI_NIR, RI_NIR, LI_IR, RI_IR

    Optics16: 1 sample × 16 channels = 40 bytes
              Channels: All 4 sensors × 4 wavelengths (NIR, IR, RED, AMB)

    Returns: np.ndarray shape (n_samples, n_channels)
    """
    # Determine samples per packet and required bytes
    if n_channels == 4:
        n_samples = 3
        bytes_needed = 30
    elif n_channels == 8:
        n_samples = 2
        bytes_needed = 40
    elif n_channels == 16:
        n_samples = 1
        bytes_needed = 40
    else:
        return None

    if len(data_bytes) < bytes_needed:
        return None

    # Convert bytes to bit array (LSB first)
    bits = _bytes_to_bits(data_bytes, bytes_needed)

    # Parse 20-bit values
    data = np.zeros((n_samples, n_channels), dtype=np.float32)

    for sample_idx in range(n_samples):
        for channel_idx in range(n_channels):
            bit_start = (sample_idx * n_channels + channel_idx) * 20

            # Extract 20 bits and scale
            int_value = _extract_packed_int(bits, bit_start, 20)
            data[sample_idx, channel_idx] = int_value * OPTICS_SCALE

    return data
