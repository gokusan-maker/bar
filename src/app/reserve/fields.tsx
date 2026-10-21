"use client";

import { useState } from "react";

export interface DateOption {
  date: string;
  label: string;
  slots: { clock: string; label: string; remaining: number }[];
}

/**
 * 来店日・人数・時間の選択欄。日付や人数を変えると、
 * その日に入れる時間（過ぎた時間・席が足りない時間を除く）だけを出し直す。
 */
export function DateTimePartyFields({ options, maxParty }: { options: DateOption[]; maxParty: number }) {
  const [party, setParty] = useState(2);
  const open = (o: DateOption, n: number) => o.slots.filter((s) => s.remaining >= n);
  const [date, setDate] = useState(() => (options.find((o) => open(o, 2).length) ?? options[0])?.date ?? "");
  const current = options.find((o) => o.date === date);
  const slots = current ? open(current, party) : [];
  const preferred = (list: typeof slots) => (list.find((s) => s.clock === "21:00") ?? list[0])?.clock ?? "";
  const [time, setTime] = useState(() => preferred(slots));
  // 選んでいた時間が選べなくなったら、近い候補に切り替える
  const selectedTime = slots.some((s) => s.clock === time) ? time : preferred(slots);

  return (
    <>
      <label>
        ご来店日
        <select name="date" required value={date} onChange={(e) => setDate(e.target.value)}>
          {options.map((o) => {
            const full = open(o, 1).length === 0;
            return (
              <option key={o.date} value={o.date} disabled={full}>
                {o.label}
                {full ? "（満席・受付終了）" : ""}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        人数
        <select name="partySize" required value={party} onChange={(e) => setParty(Number(e.target.value))}>
          {Array.from({ length: maxParty }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}名
            </option>
          ))}
        </select>
      </label>
      <label>
        お時間
        {slots.length ? (
          <select name="time" required value={selectedTime} onChange={(e) => setTime(e.target.value)}>
            {slots.map((s) => (
              <option key={s.clock} value={s.clock}>
                {s.label}
                {s.remaining - party < 3 ? "（残りわずか）" : ""}
              </option>
            ))}
          </select>
        ) : (
          <>
            {/* 空きがない日は送信できないよう、空の必須欄にする */}
            <select name="time" required value="" disabled>
              <option value="">この人数で入れるお時間がありません</option>
            </select>
            <span className="muted">別の日付か人数をお選びください。</span>
          </>
        )}
      </label>
    </>
  );
}
