import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  backToQuestions,
  continueToPay,
  DEMO_FEE_RUPEES,
  DEMO_TRACKS,
  DEMO_YEARS,
  formatRupees,
  initialDemoState,
  resetDemo,
  seatsText,
  setDemoField,
  submitDemo,
  type DemoField,
  type DemoState,
} from "../../lib/landingDemo";

const FIELD_ORDER: DemoField[] = ["name", "year", "track", "utr"];

/** Working sample form. State lives in lib/landingDemo.ts; nothing is sent anywhere. */
export default function LandingDemo() {
  const [state, setState] = useState<DemoState>(initialDemoState);
  const uid = useId();
  const headingRef = useRef<HTMLParagraphElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevStage = useRef(state.stage);
  const pendingFocus = useRef<DemoField | null>(null);

  // Move focus to the stage heading when the stage changes (not on first paint).
  useEffect(() => {
    if (prevStage.current === state.stage) return;
    prevStage.current = state.stage;
    headingRef.current?.focus();
  }, [state.stage]);

  // After a failed submit, focus the first invalid field.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const first = FIELD_ORDER.find((f) => state.errors[f]);
    pendingFocus.current = null;
    if (!first) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`);
    el?.focus();
  }, [state.errors]);

  const full = state.seatsLeft <= 0;
  const err = (f: DemoField) => state.errors[f];
  const set = (f: DemoField, v: string) => setState((s) => setDemoField(s, f, v));

  function onContinue(e: FormEvent) {
    e.preventDefault();
    pendingFocus.current = "name";
    setState((s) => continueToPay(s));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    pendingFocus.current = "utr";
    setState((s) => submitDemo(s));
  }

  return (
    <section className="demo" aria-labelledby={`${uid}-label`} ref={rootRef}>
      <div className="demo-head">
        <p className="demo-label" id={`${uid}-label`}>
          Try it. Nothing is sent.
        </p>
        <p className="demo-seats" aria-live="polite">
          {seatsText(state.seatsLeft)}
        </p>
      </div>
      <p className="demo-title">Hack Night 2.0 registration</p>

      {state.stage === "questions" ? (
        <form className="demo-form" onSubmit={onContinue} noValidate>
          <p className="demo-step" ref={headingRef} tabIndex={-1}>
            Step 1 of 2. Your details
          </p>
          {full ? (
            <p className="demo-full" role="status">
              This form is full. Seats are limited, and this one has none left.
            </p>
          ) : null}

          <div className="demo-field">
            <label htmlFor={`${uid}-name`}>Your name</label>
            <input
              id={`${uid}-name`}
              data-field="name"
              type="text"
              maxLength={60}
              placeholder="Asha Verma"
              autoComplete="off"
              value={state.name}
              onChange={(e) => set("name", e.target.value)}
              aria-invalid={err("name") ? true : undefined}
              aria-describedby={err("name") ? `${uid}-name-err` : undefined}
              required
            />
            {err("name") ? (
              <p className="demo-error" id={`${uid}-name-err`}>
                {err("name")}
              </p>
            ) : null}
          </div>

          <fieldset
            className="demo-field"
            aria-describedby={err("year") ? `${uid}-year-err` : undefined}
          >
            <legend>Year of study</legend>
            <div className="demo-options">
              {DEMO_YEARS.map((y, i) => (
                <label key={y} className="demo-option">
                  <input
                    type="radio"
                    name={`${uid}-year`}
                    data-field={i === 0 ? "year" : undefined}
                    checked={state.year === y}
                    onChange={() => set("year", y)}
                  />
                  <span>{y}</span>
                </label>
              ))}
            </div>
            {err("year") ? (
              <p className="demo-error" id={`${uid}-year-err`}>
                {err("year")}
              </p>
            ) : null}
          </fieldset>

          <fieldset
            className="demo-field"
            aria-describedby={err("track") ? `${uid}-track-err` : undefined}
          >
            <legend>Track</legend>
            <div className="demo-options">
              {DEMO_TRACKS.map((t, i) => (
                <label key={t} className="demo-option">
                  <input
                    type="radio"
                    name={`${uid}-track`}
                    data-field={i === 0 ? "track" : undefined}
                    checked={state.track === t}
                    onChange={() => set("track", t)}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
            {err("track") ? (
              <p className="demo-error" id={`${uid}-track-err`}>
                {err("track")}
              </p>
            ) : null}
          </fieldset>

          <button type="submit" className="btn btn-primary" disabled={full}>
            Continue to payment
          </button>
        </form>
      ) : null}

      {state.stage === "pay" ? (
        <form className="demo-form" onSubmit={onSubmit} noValidate>
          <p className="demo-step" ref={headingRef} tabIndex={-1}>
            Pay {formatRupees(DEMO_FEE_RUPEES)} by UPI
          </p>
          <p className="demo-text">
            Send {formatRupees(DEMO_FEE_RUPEES)} to the sample UPI ID hacknight@demo, then paste the UTR from your UPI app.
          </p>
          <div className="demo-field">
            <label htmlFor={`${uid}-utr`}>UTR number</label>
            <input
              id={`${uid}-utr`}
              data-field="utr"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={35}
              value={state.utr}
              onChange={(e) => set("utr", e.target.value)}
              aria-invalid={err("utr") ? true : undefined}
              aria-describedby={err("utr") ? `${uid}-utr-err` : undefined}
            />
            {err("utr") ? (
              <p className="demo-error" id={`${uid}-utr-err`}>
                {err("utr")}
              </p>
            ) : null}
          </div>
          <p className="demo-note">Real forms also ask for a payment screenshot, and the organiser checks both.</p>
          <div className="demo-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setState((s) => backToQuestions(s))}>
              Back
            </button>
            <button type="submit" className="btn btn-primary">
              Submit
            </button>
          </div>
        </form>
      ) : null}

      {state.stage === "done" ? (
        <div className="demo-form">
          <p className="demo-step" ref={headingRef} tabIndex={-1}>
            Registered, {state.name.trim()}.
          </p>
          <p className="demo-text">
            Your payment shows as pending until the organiser checks the UTR. {state.seatsLeft} seats left.
          </p>
          <div className="demo-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setState(resetDemo())}>
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
