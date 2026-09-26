/* ============================================================
   Minimal ID3v2.2 / v2.3 / v2.4 tag reader.
   No external dependencies — reads TIT2/TT2 (title), TPE1/TP1
   (artist), TALB/TAL (album) and APIC/PIC (cover art).
   Returns null if no usable tag is found (caller falls back to filename).
   ============================================================ */

const ID3 = (() => {

  function readSynchsafeInt(view, offset) {
    return (
      ((view.getUint8(offset) & 0x7f) << 21) |
      ((view.getUint8(offset + 1) & 0x7f) << 14) |
      ((view.getUint8(offset + 2) & 0x7f) << 7) |
      (view.getUint8(offset + 3) & 0x7f)
    );
  }

  function readUint32(view, offset) {
    return (
      (view.getUint8(offset) << 24) |
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3)
    ) >>> 0;
  }

  function decodeText(bytes, encodingByte) {
    try {
      if (encodingByte === 0) {
        return new TextDecoder("iso-8859-1").decode(bytes).replace(/\0+$/, "");
      } else if (encodingByte === 1) {
        const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : "utf-16be";
        return new TextDecoder(bom).decode(bytes.slice(2)).replace(/\0+$/, "");
      } else if (encodingByte === 2) {
        return new TextDecoder("utf-16be").decode(bytes).replace(/\0+$/, "");
      } else {
        return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/, "");
      }
    } catch (e) {
      return "";
    }
  }

  function parseTextFrame(bytes) {
    const encodingByte = bytes[0];
    return decodeText(bytes.slice(1), encodingByte).trim();
  }

  function parseApicFrame(bytes, isV22) {
    let offset = 0;
    const encodingByte = bytes[offset]; offset += 1;

    let mime;
    if (isV22) {
      mime = "image/" + String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]).toLowerCase();
      offset += 3;
    } else {
      let end = offset;
      while (end < bytes.length && bytes[end] !== 0) end++;
      mime = new TextDecoder("iso-8859-1").decode(bytes.slice(offset, end)) || "image/jpeg";
      offset = end + 1;
    }

    offset += 1; // picture type

    if (encodingByte === 1 || encodingByte === 2) {
      let end = offset;
      while (end < bytes.length - 1 && !(bytes[end] === 0 && bytes[end + 1] === 0)) end += 2;
      offset = end + 2;
    } else {
      let end = offset;
      while (end < bytes.length && bytes[end] !== 0) end++;
      offset = end + 1;
    }

    const imageBytes = bytes.slice(offset);
    if (!imageBytes.length) return null;
    if (!/^image\//.test(mime)) mime = "image/jpeg";
    return new Blob([imageBytes], { type: mime });
  }

  function parse(buffer) {
    try {
      const view = new DataView(buffer);
      if (view.byteLength < 10) return null;
      if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2)) !== "ID3") {
        return null;
      }
      const majorVersion = view.getUint8(3);
      const flags = view.getUint8(5);
      const tagSize = readSynchsafeInt(view, 6);
      const hasExtHeader = !!(flags & 0x40);

      let pos = 10;
      if (hasExtHeader && majorVersion >= 3) {
        const extSize = majorVersion === 4 ? readSynchsafeInt(view, pos) : readUint32(view, pos);
        pos += extSize + (majorVersion === 4 ? 0 : 4);
      }

      const tagEnd = Math.min(10 + tagSize, view.byteLength);
      const result = { title: "", artist: "", album: "", artwork: null };
      const isV22 = majorVersion === 2;

      while (pos < tagEnd - 4) {
        let frameId, frameSize, headerLen;

        if (isV22) {
          frameId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2));
          frameSize = (view.getUint8(pos + 3) << 16) | (view.getUint8(pos + 4) << 8) | view.getUint8(pos + 5);
          headerLen = 6;
        } else {
          frameId = String.fromCharCode(
            view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3)
          );
          frameSize = majorVersion === 4 ? readSynchsafeInt(view, pos + 4) : readUint32(view, pos + 4);
          headerLen = 10;
        }

        if (!/^[A-Z0-9]+$/.test(frameId) || frameSize <= 0 || pos + headerLen + frameSize > view.byteLength) break;

        const frameBytes = new Uint8Array(buffer, pos + headerLen, frameSize);

        if (frameId === "TIT2" || frameId === "TT2") result.title = parseTextFrame(frameBytes);
        else if (frameId === "TPE1" || frameId === "TP1") result.artist = parseTextFrame(frameBytes);
        else if (frameId === "TALB" || frameId === "TAL") result.album = parseTextFrame(frameBytes);
        else if ((frameId === "APIC" || frameId === "PIC") && !result.artwork) {
          result.artwork = parseApicFrame(frameBytes, isV22);
        }

        pos += headerLen + frameSize;
      }

      if (!result.title && !result.artist && !result.album && !result.artwork) return null;
      return result;
    } catch (e) {
      console.warn("ID3 parse failed", e);
      return null;
    }
  }

  return { parse };
})();

/* ============================================================
   Minimal MP4/M4A metadata reader (the iTunes-style atom layout:
   moov/udta/meta/ilst). Different container entirely from ID3 — MP3 has ID3
   frames, MP4/M4A stores tags as nested boxes, so an .m4a file's embedded
   cover (the 'covr' atom) is invisible to the ID3 parser above and needs its
   own walker. Returns null if no usable tag is found.
   ============================================================ */

const MP4Tag = (() => {
  function readUint32(view, offset) {
    return (
      (view.getUint8(offset) << 24) |
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3)
    ) >>> 0;
  }

  // Walks sibling boxes in [start, end) looking for one matching fourcc.
  function findAtom(view, start, end, fourcc) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = readUint32(view, pos);
      const type = String.fromCharCode(
        view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7)
      );
      let headerSize = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        size = Number(view.getBigUint64(pos + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;
      if (type === fourcc) return { start: pos + headerSize, end: pos + size };
      pos += size;
    }
    return null;
  }

  // An iTunes metadata item (e.g. ©nam, covr) wraps its payload in a child
  // 'data' box: [8-byte box header][4-byte type indicator][4-byte locale][payload].
  function readDataPayload(view, buffer, start, end) {
    const data = findAtom(view, start, end, "data");
    if (!data) return null;
    const payloadStart = data.start + 8;
    if (payloadStart >= data.end) return null;
    return new Uint8Array(buffer, payloadStart, data.end - payloadStart);
  }

  function readTextAtom(view, buffer, start, end) {
    const bytes = readDataPayload(view, buffer, start, end);
    if (!bytes) return "";
    try { return new TextDecoder("utf-8").decode(bytes).trim(); } catch (e) { return ""; }
  }

  function sniffImageMime(bytes) {
    return bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
  }

  function parse(buffer) {
    try {
      const view = new DataView(buffer);
      const moov = findAtom(view, 0, buffer.byteLength, "moov");
      if (!moov) return null;
      const udta = findAtom(view, moov.start, moov.end, "udta");
      if (!udta) return null;
      const meta = findAtom(view, udta.start, udta.end, "meta");
      if (!meta) return null;
      // 'meta' is normally a full box (4-byte version+flags before its children),
      // but some non-Apple encoders write it as a plain container — try both.
      const ilst = findAtom(view, meta.start + 4, meta.end, "ilst") || findAtom(view, meta.start, meta.end, "ilst");
      if (!ilst) return null;

      const result = { title: "", artist: "", album: "", artwork: null };

      const nam = findAtom(view, ilst.start, ilst.end, "©nam");
      if (nam) result.title = readTextAtom(view, buffer, nam.start, nam.end);
      const artistAtom = findAtom(view, ilst.start, ilst.end, "©ART");
      if (artistAtom) result.artist = readTextAtom(view, buffer, artistAtom.start, artistAtom.end);
      const alb = findAtom(view, ilst.start, ilst.end, "©alb");
      if (alb) result.album = readTextAtom(view, buffer, alb.start, alb.end);

      const covr = findAtom(view, ilst.start, ilst.end, "covr");
      if (covr) {
        const bytes = readDataPayload(view, buffer, covr.start, covr.end);
        if (bytes && bytes.length) result.artwork = new Blob([bytes], { type: sniffImageMime(bytes) });
      }

      if (!result.title && !result.artist && !result.album && !result.artwork) return null;
      return result;
    } catch (e) {
      console.warn("MP4 tag parse failed", e);
      return null;
    }
  }

  return { parse };
})();