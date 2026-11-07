// 最小限のxlsxリーダー (名前空間接頭辞 x: 付きのワークブックも読める)。依存は fflate のみ。
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const colIdx = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function readXlsx(path) {
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const text = (n) => (files[n] ? strFromU8(files[n]) : '');
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/')]));
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => ent([...m[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join('')));
  const sheets = {};
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = ent(m[0].match(/name="([^"]*)"/)[1]);
    const rid = m[0].match(/r:id="([^"]+)"/)[1];
    const xml = text(relMap[rid]);
    const rows = [];
    for (const r of xml.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const row = [];
      for (const c of (r[1] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)[1];
        const t = (attrs.match(/\bt="([^"]+)"/) ?? [])[1];
        const body = c[2] ?? '';
        let v;
        if (t === 'inlineStr') v = [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((x) => ent(x[1])).join('');
        else {
          const vm = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
          v = vm ? (t === 's' ? shared[+vm[1]] : t === 'str' ? ent(vm[1]) : t === 'b' ? vm[1] === '1' : Number.isNaN(+vm[1]) ? ent(vm[1]) : +vm[1]) : undefined;
        }
        row[colIdx(ref)] = v;
      }
      rows.push(row);
    }
    sheets[name] = rows;
  }
  return sheets;
}
export function table(rows) {
  const head = rows[0] ?? [];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
