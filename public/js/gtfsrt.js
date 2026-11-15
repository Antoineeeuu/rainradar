// Décodeur minimal du format GTFS-Realtime (protobuf), sans dépendance.
// Seuls les champs utiles à RailRadar sont lus : TripUpdate et Alert.

const utf8 = new TextDecoder('utf-8');

class Reader {
  constructor(buf, pos, end) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
    this.lo = 0;
    this.hi = 0;
  }

  varint() {
    const buf = this.buf;
    let pos = this.pos;
    let lo = 0;
    let hi = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      const b = buf[pos++];
      if (shift < 28) lo |= (b & 0x7f) << shift;
      else if (shift === 28) {
        lo |= (b & 0x0f) << 28;
        hi |= (b & 0x7f) >> 4;
      } else hi |= (b & 0x7f) << (shift - 32);
      shift += 7;
      if (b < 0x80) break;
    }
    this.pos = pos;
    this.lo = lo >>> 0;
    this.hi = hi >>> 0;
  }

  uint() {
    this.varint();
    return this.hi * 4294967296 + this.lo;
  }

  int32() {
    this.varint();
    return this.lo | 0;
  }

  int64() {
    this.varint();
    if (this.hi & 0x80000000) return -((~this.hi >>> 0) * 4294967296 + (~this.lo >>> 0) + 1);
    return this.hi * 4294967296 + this.lo;
  }

  // Parcourt les champs d'un message : cb(numéro, type, lecteur). Pour les champs
  // « longueur + contenu » (type 2), cb reçoit les bornes [start, end) dans r.subStart/r.subEnd.
  each(cb) {
    while (this.pos < this.end) {
      this.varint();
      const field = this.lo >>> 3;
      const wire = this.lo & 7;
      if (wire === 0) {
        cb(field, 0, this);
      } else if (wire === 2) {
        const len = this.uint();
        const start = this.pos;
        this.subStart = start;
        this.subEnd = start + len;
        cb(field, 2, this);
        this.pos = start + len;
      } else if (wire === 1) {
        this.pos += 8;
      } else if (wire === 5) {
        this.pos += 4;
      } else {
        throw new Error('protobuf: type de champ inattendu ' + wire);
      }
    }
  }

  sub() {
    return new Reader(this.buf, this.subStart, this.subEnd);
  }

  str() {
    return utf8.decode(this.buf.subarray(this.subStart, this.subEnd));
  }
}

// Sur un champ varint non lu par le callback, il faut tout de même avancer le curseur.
function skipOrRead(r, wire) {
  if (wire === 0) r.varint();
}

function readStopTimeEvent(r) {
  const ev = { delay: 0, time: 0 };
  r.each((f, w, x) => {
    if (f === 1 && w === 0) ev.delay = x.int32();
    else if (f === 2 && w === 0) ev.time = x.int64();
    else skipOrRead(x, w);
  });
  return ev;
}

function readStopTimeUpdate(r) {
  const s = { stopId: '', arr: null, dep: null, rel: 0 };
  r.each((f, w, x) => {
    if (w === 2) {
      if (f === 4) s.stopId = x.str();
      else if (f === 2) s.arr = readStopTimeEvent(x.sub());
      else if (f === 3) s.dep = readStopTimeEvent(x.sub());
    } else if (f === 5 && w === 0) s.rel = x.uint();
    else skipOrRead(x, w);
  });
  return s;
}

function readTripDescriptor(r, out) {
  r.each((f, w, x) => {
    if (w === 2) {
      if (f === 1) out.tripId = x.str();
      else if (f === 3) out.startDate = x.str();
      else if (f === 2) out.startTime = x.str();
    } else if (f === 4 && w === 0) out.rel = x.uint();
    else skipOrRead(x, w);
  });
}

function readTripUpdate(r) {
  const tu = { tripId: '', startDate: '', startTime: '', rel: 0, ts: 0, stops: [] };
  r.each((f, w, x) => {
    if (w === 2) {
      if (f === 1) readTripDescriptor(x.sub(), tu);
      else if (f === 2) tu.stops.push(readStopTimeUpdate(x.sub()));
    } else if (f === 4 && w === 0) tu.ts = x.uint();
    else skipOrRead(x, w);
  });
  return tu;
}

/** Décode un flux « trip updates ». Renvoie { timestamp, trips: [...] }. */
export function decodeTripUpdates(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const out = { timestamp: 0, trips: [] };
  new Reader(buf, 0, buf.length).each((f, w, x) => {
    if (w !== 2) return skipOrRead(x, w);
    if (f === 1) {
      x.sub().each((f2, w2, y) => {
        if (f2 === 3 && w2 === 0) out.timestamp = y.uint();
        else skipOrRead(y, w2);
      });
    } else if (f === 2) {
      x.sub().each((f2, w2, y) => {
        if (f2 === 3 && w2 === 2) out.trips.push(readTripUpdate(y.sub()));
        else skipOrRead(y, w2);
      });
    }
  });
  return out;
}

function readTranslated(r) {
  const out = {};
  r.each((f, w, x) => {
    if (f === 1 && w === 2) {
      let text = '';
      let lang = '';
      x.sub().each((f2, w2, y) => {
        if (w2 === 2) {
          if (f2 === 1) text = y.str();
          else if (f2 === 2) lang = y.str();
        } else skipOrRead(y, w2);
      });
      out[lang || 'fr'] = text;
    } else skipOrRead(x, w);
  });
  return out;
}

/** Décode un flux « service alerts ». Renvoie [{ trips: [ids], header: {fr,en}, text: {fr,en} }]. */
export function decodeAlerts(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const alerts = [];
  new Reader(buf, 0, buf.length).each((f, w, x) => {
    if (w !== 2) return skipOrRead(x, w);
    if (f !== 2) return;
    x.sub().each((f2, w2, y) => {
      if (!(f2 === 5 && w2 === 2)) return skipOrRead(y, w2);
      const a = { trips: [], header: {}, text: {} };
      const seen = new Set();
      y.sub().each((f3, w3, z) => {
        if (w3 !== 2) return skipOrRead(z, w3);
        if (f3 === 5) {
          z.sub().each((f4, w4, q) => {
            if (f4 === 4 && w4 === 2) {
              q.sub().each((f5, w5, p) => {
                if (f5 === 1 && w5 === 2) {
                  const id = p.str();
                  if (!seen.has(id)) {
                    seen.add(id);
                    a.trips.push(id);
                  }
                } else skipOrRead(p, w5);
              });
            } else skipOrRead(q, w4);
          });
        } else if (f3 === 10) a.header = readTranslated(z.sub());
        else if (f3 === 11) a.text = readTranslated(z.sub());
      });
      if (a.trips.length) alerts.push(a);
    });
  });
  return alerts;
}
