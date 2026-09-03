import struct, zlib, os

def make_png(size, color=(255, 100, 0)):
    def chunk(name, data):
        c = name + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    raw = b""
    for _ in range(size):
        row = b"\x00" + bytes(color) * size
        raw += row
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend

base = os.path.dirname(os.path.abspath(__file__))
for sz, name in [(16, "icon16.png"), (48, "icon48.png"), (128, "icon128.png")]:
    with open(os.path.join(base, name), "wb") as f:
        f.write(make_png(sz))
    print(f"Created {name} ({sz}x{sz})")
