import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <main className="landing">
      <div className="landing-card">
        <p className="eyebrow">Qivo Forms</p>

        <h1>Create forms people enjoy completing.</h1>

        <p>Build, publish, and collect responses from one place.</p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="primary-link" to="/login">
            Log in
          </Link>
          <Link
            className="secondary-link"
            to="/signup"
            style={{ marginTop: 24, padding: "13px 18px" }}
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  );
}
