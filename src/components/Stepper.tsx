"use client";

type StepperProps = {
  steps: string[];
  current: number; // índice 0..n
};

export default function Stepper({ steps, current }: StepperProps) {
  return (
    <div className="kids-stepper">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "";
        return (
          <div className={`kids-step ${state}`} key={label}>
            <div className="dot">{i < current ? "✓" : i + 1}</div>
            <div className="label font-kids">{label}</div>
          </div>
        );
      })}
    </div>
  );
}
