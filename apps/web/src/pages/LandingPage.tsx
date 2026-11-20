import { useRef } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import { useReveal } from "../lib/useReveal";
import LandingDemo from "./landing/LandingDemo";
import "../styles/landing.css";

const STRIP = ["olive", "moss", "cream", "lime", "orchid", "stone", "berry", "deep"] as const;

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ["UPI payments", "Collect fees with Razorpay or your own UPI ID."],
  ["Seats limit", "Set the number of seats. The form shows when they run out."],
  ["Resume later", "Respondents save progress and finish another day."],
  ["Quiz mode", "Mark answers and show a score automatically."],
  ["Webhooks", "Send every response to your own system."],
  ["Works as an app", "Install Qivo from the browser, on phone or desktop."],
];

const FEATURES: ReadonlyArray<readonly [string, string]> = [
  [
    "Question types",
    "Short and long text, choice, checkboxes, dropdown, grids, scale, rating, date, time, file upload and signature.",
  ],
  ["Sharing and invites", "Share a link or QR code. Invite people to respond, edit or view."],
  [
    "Razorpay and manual UPI",
    "Take payments online, or show a UPI ID and check each UTR and screenshot yourself.",
  ],
  ["Response capacity", "Set a seat limit. The form shows that it is full when the seats run out."],
  ["Save and resume", "Partial answers are kept so people can return and finish."],
  [
    "Piping and sections",
    "Reuse an earlier answer in a later question. Show sections only when a condition is met.",
  ],
  ["Quiz mode", "Give each question a score and a correct answer."],
  ["Webhooks", "Post each response to a URL you control."],
  ["Review before publish", "Send a form for review, ask for changes, then publish."],
  ["Export", "Download responses as CSV or Excel."],
  ["Dark mode", "Follows your device, or switch it yourself."],
  ["Installable app", "Add Qivo to your home screen like any other app."],
];

const STEPS: ReadonlyArray<readonly [string, string, string]> = [
  ["01", "Build the form", "Add your questions and set a seat limit. Turn on a UPI fee if the event is paid."],
  ["02", "Share the link", "Send the link or show the QR code on a projector."],
  ["03", "Review responses", "Check payments, watch the numbers, and export to Excel."],
];

const INDIA: ReadonlyArray<readonly [string, string]> = [
  ["Fees by UPI", "Collect registration fees through Razorpay or your own UPI ID. Amounts are in rupees."],
  ["College events", "Fests, hackathons, workshops and seminars, with a seat limit on each."],
  ["Clubs and departments", "Add teammates to a workspace as admin, editor or viewer."],
  [
    "Registration and attendance",
    "Use one form to register people and another to take attendance or feedback.",
  ],
];

function Strip({ className = "" }: { className?: string }) {
  return (
    <div className={`l-strip ${className}`.trim()} aria-hidden="true">
      {STRIP.map((name) => (
        <span key={name} className={`l-strip-seg l-strip-${name}`} />
      ))}
    </div>
  );
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  return (
    <div className="app-root app-shell l-root" ref={rootRef}>
      <a className="l-skip" href="#main">
        Skip to content
      </a>

      <header className="l-hero">
        <div className="l-wrap">
          <nav className="l-nav" aria-label="Primary">
            <Logo to="/" size="lg" tone="on-indigo" />
            <ul className="l-nav-links">
              <li className="l-nav-anchor">
                <a href="#features">Features</a>
              </li>
              <li className="l-nav-anchor">
                <a href="#how">How it works</a>
              </li>
              <li className="l-nav-anchor">
                <a href="#india">India</a>
              </li>
              <li>
                <Link to="/login" className="l-nav-login">
                  Log in
                </Link>
              </li>
              <li>
                <Link to="/signup" className="btn btn-sm l-nav-cta">
                  Get started
                </Link>
              </li>
            </ul>
          </nav>

          <div className="l-hero-grid">
            <div className="l-hero-copy">
              <p className="l-kicker">Forms for colleges, clubs and events in India</p>
              <h1 className="l-h1">Registrations and fees, in one form.</h1>
              <p className="l-lede">
                Qivo is a form builder for colleges, teachers, student clubs and event organisers. Take fees by UPI,
                cap the number of seats, and see every response in one place.
              </p>
              <div className="l-actions">
                <Link to="/signup" className="btn btn-accent btn-lg">
                  Get started
                </Link>
                <a href="#how" className="btn btn-lg l-btn-outline">
                  See how it works
                </a>
              </div>
            </div>
            <div className="l-hero-demo">
              <LandingDemo />
            </div>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="l-facts" aria-labelledby="facts-h">
          <h2 id="facts-h" className="sr-only">
            What Qivo does
          </h2>
          <div className="l-wrap">
            <ul className="l-facts-grid">
              {FACTS.map(([term, line]) => (
                <li key={term} className="l-fact reveal">
                  <p className="l-fact-term">{term}</p>
                  <p className="l-fact-line">{line}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="l-features" id="features" aria-labelledby="features-h">
          <div className="l-wrap l-features-grid">
            <div className="l-features-head reveal">
              <p className="l-label">Features</p>
              <h2 id="features-h" className="l-h2">
                Everything on the form, and what happens after.
              </h2>
            </div>
            <ul className="l-list">
              {FEATURES.map(([term, line]) => (
                <li key={term} className="l-list-item reveal">
                  <p className="l-list-term">{term}</p>
                  <p className="l-list-line">{line}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="l-how" id="how" aria-labelledby="how-h">
          <div className="l-wrap">
            <p className="l-label">How it works</p>
            <h2 id="how-h" className="l-h2 reveal">
              Three steps.
            </h2>
            <ol className="l-steps">
              {STEPS.map(([num, title, line]) => (
                <li key={num} className="l-step reveal">
                  <span className="l-step-num" aria-hidden="true">
                    {num}
                  </span>
                  <p className="l-step-title">{title}</p>
                  <p className="l-step-line">{line}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="l-india" id="india" aria-labelledby="india-h">
          <div className="l-wrap l-india-grid">
            <p className="l-rupee" aria-hidden="true">
              {"\u20B9"}
            </p>
            <div className="l-india-body">
              <h2 id="india-h" className="l-h2 reveal">
                Made for how Indian colleges run events.
              </h2>
              <ul className="l-list l-list-on-berry">
                {INDIA.map(([term, line]) => (
                  <li key={term} className="l-list-item reveal">
                    <p className="l-list-term">{term}</p>
                    <p className="l-list-line">{line}</p>
                  </li>
                ))}
              </ul>
              <p className="l-mono-note">Qivo is in English.</p>
            </div>
          </div>
        </section>

        <section className="l-close" aria-labelledby="close-h">
          <div className="l-wrap">
            <h2 id="close-h" className="l-h2 l-close-h reveal">
              Build your first form today.
            </h2>
            <p className="l-lede">Set up a registration form, share the link, and watch the responses come in.</p>
            <div className="l-actions">
              <Link to="/signup" className="btn btn-accent btn-lg">
                Get started
              </Link>
              <Link to="/login" className="btn btn-lg l-btn-outline">
                Log in
              </Link>
            </div>
          </div>
          <Strip className="l-strip-lg" />
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-wrap l-footer-row">
          <Logo to="/" size="sm" />
          <p className="l-mono-note">Forms for colleges, clubs and events in India.</p>
          <ul className="l-footer-links">
            <li>
              <Link to="/login">Log in</Link>
            </li>
            <li>
              <Link to="/signup">Get started</Link>
            </li>
            <li>
              <Link to="/forgot-password">Reset password</Link>
            </li>
          </ul>
          <p className="l-mono-note">&copy; {new Date().getFullYear()} Qivo</p>
        </div>
      </footer>
    </div>
  );
}
