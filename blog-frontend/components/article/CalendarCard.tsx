"use client";

import { MorphIcon } from "morphicons/react";
import { Calendar as CalendarIcon } from "lucide";

interface CalendarCardProps {
  date: string;
  loading?: boolean;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export default function CalendarCard({
  date,
  loading = false,
}: CalendarCardProps) {
  const d = new Date(date);
  const publishWeekday = d.getDay();

  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - publishWeekday);

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    return day;
  });

  return (
    <div className="side-card">
      {loading ? (
        /* 骨架 */
        <div className="sk-calendar">
          <div className="sk-line w-50" />
          <div className="sk-calendar-week">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="sk-cell">
                <div className="sk-line w-60" />
                <div className="sk-circle" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* 真实内容 */
        <>
          <div className="side-calendar-header">
            <span className="inline-flex items-center gap-2">
              <MorphIcon
                icon={CalendarIcon}
                size={14}
                style={{ color: "var(--accent)" }}
              />
              {d.getFullYear()}年{d.getMonth() + 1}月
            </span>
            <span
              className="text-[10px] font-normal"
              style={{ color: "var(--text-secondary)" }}
            >
              发布周
            </span>
          </div>

          <div className="week-calendar">
            {days.map((day, i) => {
              const isPublish = i === publishWeekday;
              return (
                <div key={i} className="week-calendar-cell">
                  <span className="week-calendar-weekday">{WEEKDAYS[i]}</span>
                  <span
                    className={`week-calendar-day ${
                      isPublish ? "highlight" : ""
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}