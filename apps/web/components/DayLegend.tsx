"use client"

import { DAY_LEGEND } from "@/lib/dayVisual"

/**
 * Расшифровка обозначений в таблице графика.
 *
 * Без неё клетки нечитаемы: буквы «В», «О» и «Б» совпадают с первыми буквами
 * слов, но главное — смена на другом складе нарисована контуром, а не
 * заливкой, и без объяснения её примут за смену этого склада.
 *
 * Плашки берутся из `dayVisual` — оттуда же, откуда их берёт клетка дня.
 * Копия цветов вторым списком неизбежно расходится с первой, и расшифровка
 * начинает врать.
 */
const DayLegend = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs">
    {DAY_LEGEND.map((item) => (
      <span
        key={item.key}
        className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground"
      >
        <span
          className={`${item.className} inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-medium`}
        >
          {item.label}
        </span>
        {item.caption}
      </span>
    ))}

    {/* Закрепление — не состояние дня, а признак «поставлено руками», поэтому
        отдельная плашка: точка стоит поверх любой заливки. */}
    <span className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
      </span>
      закреплено — алгоритм не переставит
    </span>

    <span className="ml-auto whitespace-nowrap text-muted-foreground">
      Клик по дню — изменить состояние. Красная цифра в итогах — людей меньше
      нормы
    </span>
  </div>
)

export default DayLegend
