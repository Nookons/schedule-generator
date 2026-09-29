import type { DayMarkKind } from "@/lib/api/types"
import type { IUser } from "@/types/User"

/**
 * Оформление состояний дня — единственный источник правды.
 *
 * Раньше цвета и подписи жили в двух местах: в клетке дня и в расшифровке под
 * таблицей. Копии расходятся, и менеджер читает расшифровку, которая врёт.
 * Экспорт в Excel — третье место, где нужны те же обозначения и те же цвета,
 * поэтому таблица вынесена из компонентов в обычный модуль.
 *
 * Цвет здесь означает состояние дня, а не человека. У каждой строки был свой
 * цвет, но смысла он не нёс, зато поверх него лежали цвета смен: в таблице на
 * десять человек получалась радуга, в которой не отличить день от ночи. Цвет
 * остался только там, где он что-то сообщает.
 */

export type DayKind =
  | "day"
  | "night"
  | "off"
  | "vacation"
  | "sick"
  | "unavailableHere"
  | "externalDay"
  | "externalNight"
  | "prefsOff"
  | "empty"

export interface DayVisual {
  kind: DayKind
  /** Буква в клетке: D, N, В, О, Б или тире. */
  label: string
  /** Классы Tailwind: заливка и цвет текста под светлую и тёмную тему. */
  className: string
  /** Подсказка при наведении — ею же объясняется расшифровка. */
  title: string
}

/**
 * Чужая смена нарисована контуром, а не заливкой: заливка читается как
 * «человек работает здесь», а он работает в другом месте. Фиолетовый остаётся
 * единственным цветом, который не встречается среди смен этого склада, — по
 * нему чужой день и находится взглядом.
 */
const EXTERNAL_CLASS =
  "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-400 dark:bg-violet-950/60 dark:text-violet-200 dark:ring-violet-500"

/**
 * Выходной по постоянным настройкам — «призрачная» отметка, а не заливка:
 * день свободен по настройке работника, а не выставлен менеджером в графике.
 * Пустой день — тире без фона: это ещё не решённый день, и он не должен
 * выглядеть как выходной.
 */
const DAY_VISUAL_TABLE: Record<DayKind, Omit<DayVisual, "kind">> = {
  day: {
    label: "D",
    className: "bg-amber-200 text-amber-950 dark:bg-amber-400/80 dark:text-amber-950",
    title: "Дневная смена",
  },
  night: {
    label: "N",
    className: "bg-blue-200 text-blue-950 dark:bg-blue-500/80 dark:text-blue-50",
    title: "Ночная смена",
  },
  off: {
    label: "В",
    className: "bg-slate-200 text-slate-700 dark:bg-slate-500/70 dark:text-slate-50",
    title: "Выходной",
  },
  vacation: {
    label: "О",
    className:
      "bg-emerald-200 text-emerald-950 dark:bg-emerald-500/70 dark:text-emerald-50",
    title: "Отпуск",
  },
  sick: {
    label: "Б",
    className: "bg-rose-200 text-rose-950 dark:bg-rose-500/70 dark:text-rose-50",
    title: "Больничный",
  },
  // «Не могу на этом складе» нарисовано контуром, как и чужая смена: заливка
  // означает «человек работает здесь», а он здесь как раз не работает. Отличает
  // их буква и цвет: фиолетовый — смена в другом месте, серый — ограничение.
  unavailableHere: {
    label: "Н",
    className:
      "bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-400 dark:bg-slate-900/40 dark:text-slate-300 dark:ring-slate-500",
    title: "Не может работать в этот день на этом складе",
  },
  externalDay: {
    label: "D",
    className: EXTERNAL_CLASS,
    title: "Дневная смена на другом складе",
  },
  externalNight: {
    label: "N",
    className: EXTERNAL_CLASS,
    title: "Ночная смена на другом складе",
  },
  prefsOff: {
    label: "В",
    className: "bg-muted/60 text-muted-foreground dark:bg-muted/40",
    title: "Выходной по постоянным настройкам работника",
  },
  empty: {
    label: "—",
    className: "text-muted-foreground/30",
    title: "Не задано",
  },
}

/** Для расшифровки под таблицей. */
const LEGEND_KINDS: readonly DayKind[] = [
  "day",
  "night",
  "off",
  "vacation",
  "sick",
  "unavailableHere",
  "externalDay",
  "prefsOff",
]

export interface LegendItem {
  key: DayKind
  label: string
  className: string
  caption: string
}

/** Подписи в расшифровке короче подсказок: рядом стоят восемь штук подряд. */
const LEGEND_CAPTION: Record<DayKind, string> = {
  day: "дневная",
  night: "ночная",
  off: "выходной",
  vacation: "отпуск",
  sick: "больничный",
  unavailableHere: "не могу здесь",
  externalDay: "другой склад",
  externalNight: "другой склад",
  prefsOff: "по настройкам",
  empty: "не задано",
}

export const DAY_LEGEND: LegendItem[] = LEGEND_KINDS.map((kind) => ({
  key: kind,
  label: DAY_VISUAL_TABLE[kind].label,
  className: DAY_VISUAL_TABLE[kind].className,
  caption: LEGEND_CAPTION[kind],
}))

const MARK_KIND: Record<DayMarkKind, DayKind> = {
  off: "off",
  vacation: "vacation",
  sick: "sick",
  // Вид отметки с сервера и состояние клетки называются по-разному: сервер
  // отвечает за то, почему человек не работает, а клетка различает ещё и где.
  unavailable: "unavailableHere",
}

/**
 * Что стоит в конкретном дне у конкретного человека.
 *
 * Порядок проверок важен и повторяет порядок в базе:
 *  - смена важнее отметки: отметка и смена несовместимы, но если в базе
 *    окажется и то и другое, показать нужно смену — человек работает;
 *  - чужая смена важнее постоянного выходного: она уже стоит в базе на другом
 *    складе, и менеджер обязан её видеть, иначе поставит человека второй раз;
 *  - пустой день — не выходной: его ещё никто не решил.
 */
export function dayKind(user: IUser, day: number): DayKind {
  if (user.dayShifts.includes(day)) return "day"
  if (user.nightShifts.includes(day)) return "night"

  const mark = user.marks[day]
  if (mark) {
    // Значение из сети, а не из типа: неизвестная отметка не должна ронять
    // таблицу — день просто останется неразобранным.
    const kind = MARK_KIND[mark]
    if (kind) return kind
  }

  const external = user.externalShifts[day]
  if (external) {
    return external.shiftType === "night" ? "externalNight" : "externalDay"
  }

  if (user.daysOffUsers.includes(day)) return "prefsOff"
  return "empty"
}

/** Оформление дня: всё, что нужно клетке, расшифровке и экспорту. */
export function dayVisual(user: IUser, day: number): DayVisual {
  const kind = dayKind(user, day)
  const base = DAY_VISUAL_TABLE[kind]

  if (kind !== "externalDay" && kind !== "externalNight") {
    return { kind, ...base }
  }

  // В подсказке — склад: «другой склад» без названия не отвечает на вопрос,
  // куда идти человеку и откуда его не ждать.
  const warehouse = user.externalShifts[day]?.warehouse
  return {
    kind,
    ...base,
    title: warehouse ? `${base.title}: ${warehouse}` : base.title,
  }
}

/**
 * Цвета для Excel. Отдельная таблица, а не парсинг Tailwind-классов: классы
 * собираются из палитры сборщиком, и превратить `bg-amber-200` в ARGB в
 * рантайме нельзя.
 */
export const EXCEL_FILL: Record<DayKind, { fill: string; text: string }> = {
  day: { fill: "FFFDE68A", text: "FF78350F" },
  night: { fill: "FFBFDBFE", text: "FF1E3A8A" },
  off: { fill: "FFE2E8F0", text: "FF334155" },
  vacation: { fill: "FFA7F3D0", text: "FF064E3B" },
  sick: { fill: "FFFECDD3", text: "FF881337" },
  unavailableHere: { fill: "FFF8FAFC", text: "FF475569" },
  externalDay: { fill: "FFEDE9FE", text: "FF6D28D9" },
  externalNight: { fill: "FFEDE9FE", text: "FF6D28D9" },
  prefsOff: { fill: "FFF8FAFC", text: "FF94A3B8" },
  empty: { fill: "FFFFFFFF", text: "FFCBD5E1" },
}
