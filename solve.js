// SPDX-License-Identifier: MIT
// Implements the record and error rules of make.fun's csv-reader 1.0.0.
// Fields are found with String#indexOf (cached next comma / LF / CR) and cut with slice; anything unusual
// (stray CRs, junk after a closing quote, quotes that never close) takes a small character-by-character path.

// Results of the slow path.
let sPos = 0;
let sEnded = 0; // 0: comma, 1: line break, 2: end of text
let sAdded = 0;

// Unquoted reading onto `value` from `pos` (csv-reader's readUnquoted): a CR not followed by LF is dropped (stray_cr).
function readUnquotedSlow(text, end, pos, value, errors, recordLine, row) {
  let start = pos;
  let added = 0;
  sEnded = 2;
  while (pos < end) {
    const c = text.charCodeAt(pos);
    if (c === 44) {
      sEnded = 0;
      break;
    }
    if (c === 10) {
      sEnded = 1;
      break;
    }
    if (c === 13) {
      if (pos + 1 < end && text.charCodeAt(pos + 1) === 10) {
        sEnded = 1;
        value += text.slice(start, pos);
        sAdded = added + pos - start;
        sPos = pos + 2;
        return value;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row });
      value += text.slice(start, pos);
      added += pos - start;
      start = ++pos;
      continue;
    }
    pos++;
  }
  value += text.slice(start, pos);
  sAdded = added + pos - start;
  sPos = pos + 1;
  return value;
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  let template = null;

  const end = text.length;
  let pos = end > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  // Next comma / LF / CR at or after some earlier position; a value below pos is stale. `end` means none.
  let cm = -1;
  let lf = -1;
  let cr = -1;

  while (pos < end) {
    let c = text.charCodeAt(pos);
    if (c === 10) {
      pos++;
      line++;
      continue;
    }
    if (c === 13 && pos + 1 < end && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      continue;
    }
    if (lf < pos) {
      lf = text.indexOf('\n', pos);
      if (lf < 0) lf = end;
    }
    if (cr < pos) {
      cr = text.indexOf('\r', pos);
      if (cr < 0) cr = end;
    }

    const recordLine = line;
    const row = header && columns === null ? null : rows.length;
    let fields;
    if (width < 0) {
      fields = [''];
      fields.length = 0;
    } else fields = template.slice();
    let nf = 0;
    let quoted = false;

    // Inside the record, lf >= pos and cr >= pos hold at every field start.
    for (;;) {
      if (c === 34) {
        quoted = true;
        const start = pos + 1;
        let close = text.indexOf('"', start);
        // Doubled quotes: keep one of each pair, joining the pieces between them.
        let head = '';
        let seg = start;
        while (close >= 0 && close + 1 < end && text.charCodeAt(close + 1) === 34) {
          head += text.slice(seg, close + 1);
          seg = close + 2;
          close = text.indexOf('"', seg);
        }
        if (close < 0) {
          errors.push({ code: 'unterminated_quote', line: recordLine, row });
          fields[nf++] = readUnquotedSlow(text, end, start, '"', errors, recordLine, row);
          pos = sPos;
          if (sEnded === 0) {
            if (cr < pos) {
              cr = text.indexOf('\r', pos);
              if (cr < 0) cr = end;
            }
            c = pos < end ? text.charCodeAt(pos) : -1;
            continue;
          }
          if (sEnded === 1) line++;
          break;
        }
        let value = seg === start ? text.slice(start, close) : head + text.slice(seg, close);
        if (lf < close) {
          do {
            line++;
            lf = text.indexOf('\n', lf + 1);
            if (lf < 0) lf = end;
          } while (lf < close);
        }
        if (cr < close) {
          do {
            if (text.charCodeAt(cr + 1) !== 10) line++;
            cr = text.indexOf('\r', cr + 1);
            if (cr < 0) cr = end;
          } while (cr < close);
          value = value.replace(/\r\n?/g, '\n');
        }
        pos = close + 1;
        if (pos >= end) {
          fields[nf++] = value;
          break;
        }
        c = text.charCodeAt(pos);
        if (c === 44) {
          fields[nf++] = value;
          pos++;
          c = pos < end ? text.charCodeAt(pos) : -1;
          continue;
        }
        if (c === 10) {
          fields[nf++] = value;
          pos++;
          line++;
          break;
        }
        if (c === 13 && pos + 1 === lf && lf < end) {
          fields[nf++] = value;
          pos += 2;
          line++;
          break;
        }
        // Junk after the closing quote.
        const v = readUnquotedSlow(text, end, pos, value, errors, recordLine, row);
        if (sAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row });
        fields[nf++] = v;
        pos = sPos;
        if (sEnded === 0) {
          if (cr < pos) {
            cr = text.indexOf('\r', pos);
            if (cr < 0) cr = end;
          }
          c = pos < end ? text.charCodeAt(pos) : -1;
          continue;
        }
        if (sEnded === 1) line++;
        break;
      }

      quoted = false;
      if (cm < pos) {
        cm = text.indexOf(',', pos);
        if (cm < 0) cm = end;
      }
      if (cm < lf) {
        if (cr > cm) {
          fields[nf++] = text.slice(pos, cm);
          pos = cm + 1;
          c = pos < end ? text.charCodeAt(pos) : -1;
          continue;
        }
      } else if (lf < end) {
        // The field ends the record at LF or CRLF.
        if (cr > lf) {
          fields[nf++] = text.slice(pos, lf);
          pos = lf + 1;
          line++;
          break;
        }
        if (cr === lf - 1) {
          fields[nf++] = text.slice(pos, cr);
          pos = lf + 1;
          line++;
          break;
        }
      } else if (cr === end) {
        // The field ends the text.
        fields[nf++] = text.slice(pos, end);
        pos = end;
        break;
      }
      // A stray CR lies ahead in this field.
      fields[nf++] = readUnquotedSlow(text, end, pos, '', errors, recordLine, row);
      pos = sPos;
      if (sEnded === 0) {
        if (cr < pos) {
          cr = text.indexOf('\r', pos);
          if (cr < 0) cr = end;
        }
        c = pos < end ? text.charCodeAt(pos) : -1;
        continue;
      }
      if (sEnded === 1) line++;
      break;
    }

    // A line that held only stray CRs is no record.
    if (nf === 1 && !quoted && fields[0] === '') continue;

    if (width < 0) {
      width = nf;
      template = [''];
      template.length = 0;
      for (let k = 0; k < width; k++) template.push('');
    }
    if (row === null) {
      columns = fields;
      continue;
    }
    if (nf < width) {
      errors.push({ code: 'short_row', line: recordLine, row, fields: nf });
      if (fields.length < width) while (fields.length < width) fields.push('');
    } else if (nf > width) {
      errors.push({ code: 'long_row', line: recordLine, row, extra: fields.splice(width) });
    }
    rows[rows.length] = fields;
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
