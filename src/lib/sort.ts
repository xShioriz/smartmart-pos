/** การเรียงลำดับตารางผ่าน URL (?sort=<key>&dir=asc|desc) — ใช้ร่วมกันทุกหน้า */
export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** อ่านค่าจาก searchParams; ค่าที่ไม่รู้จักตกกลับเป็นค่าเริ่มต้น (ไม่เชื่อ input จาก URL) */
export function parseSort<K extends string>(keys: readonly K[], sp: { sort?: string; dir?: string }, fallback: SortState<K>): SortState<K> {
  const key = keys.find((k) => k === sp.sort);
  if (!key) return fallback;
  return { key, dir: sp.dir === "desc" ? "desc" : "asc" };
}

/** ค่าเรียงที่ควรไปเมื่อกดหัวคอลัมน์ key: กดซ้ำคอลัมน์เดิม = สลับทิศ; คอลัมน์ใหม่ = ทิศเริ่มต้นของมัน */
export function nextSort<K extends string>(cur: SortState<K>, key: K, firstDir: SortDir = "asc"): SortState<K> {
  return cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir };
}

export type SortLink = { href: string; active: SortDir | null };

/** สร้างลิงก์หัวคอลัมน์ทุกคีย์ (ข้อมูลล้วน ส่งเข้า Client Component ได้); descFirst = คอลัมน์ที่กดครั้งแรกให้มากไปน้อย */
export function sortLinks<K extends string>(keys: readonly K[], cur: SortState<K>, build: (s: SortState<K>) => string, descFirst: readonly K[] = []): Record<K, SortLink> {
  const out = {} as Record<K, SortLink>;
  for (const k of keys) out[k] = { href: build(nextSort(cur, k, descFirst.includes(k) ? "desc" : "asc")), active: cur.key === k ? cur.dir : null };
  return out;
}

/** ตัวเทียบข้อความภาษาไทย (ตามพจนานุกรม) และเลขในข้อความเรียงตามค่า */
const collator = new Intl.Collator("th", { numeric: true, sensitivity: "base" });
export const compareText = (a: string, b: string) => collator.compare(a, b);

export type SortValue = string | number | null | undefined;

/**
 * เรียงแถวในแอป (ใช้กับตารางเล็กที่ไม่แบ่งหน้า): ข้อความเรียงตามพจนานุกรมไทย ตัวเลขเรียงตามค่า
 * ค่าว่าง (null/undefined) อยู่ท้ายเสมอทั้งสองทิศ; ค่าเท่ากันเรียงตาม tie เพื่อให้ลำดับคงที่
 */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, get: Record<K, (r: T) => SortValue>, tie?: (r: T) => string): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const pick = get[sort.key];
  const byTie = (a: T, b: T) => (tie ? compareText(tie(a), tie(b)) : 0);
  return [...rows].sort((a, b) => {
    const x = pick(a), y = pick(b);
    const xe = x === null || x === undefined, ye = y === null || y === undefined;
    if (xe || ye) return xe && ye ? byTie(a, b) : xe ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : compareText(String(x), String(y));
    return sign * c || byTie(a, b);
  });
}

/**
 * ฐานข้อมูลเรียงตัวอักษรไทยตามรหัสอักขระ (สระนำ เ แ โ ไ ไปอยู่ท้าย) จึงเรียงคอลัมน์ข้อความไทยในแอปแทน:
 * ดึงเฉพาะ id+ข้อความทั้งหมดที่ตรงเงื่อนไข เรียง แล้วคืน id ของหน้าที่ขอ
 */
export function thaiSortedPageIds<T extends { id: string }>(items: T[], text: (t: T) => string, tie: (t: T) => string, dir: SortDir, page: number, size: number): string[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items]
    .sort((a, b) => sign * compareText(text(a), text(b)) || compareText(tie(a), tie(b)) || (a.id < b.id ? -1 : 1))
    .slice((page - 1) * size, page * size)
    .map((t) => t.id);
}
