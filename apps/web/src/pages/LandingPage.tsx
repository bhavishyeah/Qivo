import { Link } from "react-router-dom";
import { getToken } from "../lib/api";

export default function LandingPage() {
  const isLoggedIn = !!getToken();

  return (
    <main className="landing-page">
      {/* Nav */}
      <nav className="landing-nav">
        <span className="landing-nav-brand">Qivo</span>
        <div className="landing-nav-links">
          {isLoggedIn ? (
            <Link to="/dashboard" className="landing-cta-secondary">
              Dashboard →
            </Link>
          ) : (
            <>
              <Link to="/login" className="landing-nav-link">Log in</Link>
              <Link to="/signup" className="landing-cta-primary">Get started free</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <p className="landing-badge">✨ Form workflow platform for colleges</p>
          <h1 className="landing-hero-title">
            Create forms.<br />
            Get the QR instantly.<br />
            Run the event.
          </h1>
          <p className="landing-hero-subtitle">
            Build, approve, share, and analyze forms from one workspace.
            Designed for teachers, event organizers, and college departments.
          </p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="landing-cta-primary large">
              Create your first form
            </Link>
            <a href="#features" className="landing-cta-secondary large">
              See how it works ↓
            </a>
          </div>
          <p className="landing-hero-note">Free to use · No credit card required</p>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features" id="features">
        <div className="landing-features-header">
          <p className="landing-badge">Features</p>
          <h2 className="landing-section-title">Everything you need to manage forms</h2>
          <p className="landing-section-subtitle">From creation to analysis, in one place.</p>
        </div>

        <div className="landing-features-grid">
          <FeatureCard
            icon="📝"
            title="Form Builder"
            description="13 question types, drag-and-drop reorder, conditional logic, and real-time preview."
          />
          <FeatureCard
            icon="📱"
            title="QR Code System"
            description="Instant QR generation, projector display mode, download PNG/SVG, copy shareable link."
          />
          <FeatureCard
            icon="✅"
            title="Approval Workflow"
            description="Submit for review, get changes requested, approve, then publish. Full accountability."
          />
          <FeatureCard
            icon="👥"
            title="Team Collaboration"
            description="Create team workspaces, invite members, assign roles. Owner, Admin, Editor, Viewer."
          />
          <FeatureCard
            icon="📊"
            title="Reports & Analytics"
            description="Automatic charts, rating distributions, response timelines. Export CSV or Excel."
          />
          <FeatureCard
            icon="📁"
            title="Organization"
            description="Folders, search, filters, tags. Find any form instantly across workspaces."
          />
          <FeatureCard
            icon="🔔"
            title="Notifications"
            description="In-app alerts for reviews, approvals, milestones. Never miss an update."
          />
          <FeatureCard
            icon="🔒"
            title="Security"
            description="Role-based access, session management, rate limiting, audit logs."
          />
          <FeatureCard
            icon="📲"
            title="PWA"
            description="Install on any device. Works offline. Mobile-first design."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="landing-how">
        <div className="landing-features-header">
          <p className="landing-badge">Workflow</p>
          <h2 className="landing-section-title">From idea to insights in minutes</h2>
        </div>

        <div className="landing-steps">
          <Step number="1" title="Create" description="Build your form with our intuitive editor. Choose from 13 question types." />
          <Step number="2" title="Approve" description="Send for review to a teacher or admin. Get feedback and iterate." />
          <Step number="3" title="Publish & Share" description="One click to publish. Get QR code, display on projector, share the link." />
          <Step number="4" title="Collect & Analyze" description="Responses flow in. View charts, export data, share reports." />
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta-section">
        <h2 className="landing-section-title">Ready to streamline your forms?</h2>
        <p className="landing-section-subtitle">
          Join college departments and event teams already using Qivo.
        </p>
        <Link to="/signup" className="landing-cta-primary large">
          Create free account
        </Link>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>Qivo Forms — Built for colleges, events, and teams.</p>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="landing-feature-card">
      <span className="landing-feature-icon">{icon}</span>
      <h3 className="landing-feature-title">{title}</h3>
      <p className="landing-feature-desc">{description}</p>
    </div>
  );
}

function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="landing-step">
      <div className="landing-step-number">{number}</div>
      <div>
        <h3 className="landing-step-title">{title}</h3>
        <p className="landing-step-desc">{description}</p>
      </div>
    </div>
  );
}
