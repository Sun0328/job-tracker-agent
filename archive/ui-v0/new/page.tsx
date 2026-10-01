"use client";

import { useState } from "react";
import { Check, FileSearch, LoaderCircle, Save, Sparkles } from "lucide-react";
import type { AnalysedJob } from "@/types/job";

const EXAMPLE = `Software Engineer
Company: Koru Digital
Location: Auckland, New Zealand
Source: SEEK

We are looking for a software engineer with 2+ years of experience building web applications.
Develop reliable TypeScript and Node.js services.
Build React interfaces and REST API integrations.
Work with AWS cloud infrastructure and SQL databases.
Experience with automated testing and agile delivery is preferred.`;

type Result = AnalysedJob & { mode?: string };

export default function NewJobPage() {
  const [jobPost, setJobPost] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function analyse() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/analyse-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobPost }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!result) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div><div className="eyebrow">New application</div><h1>Bring the job.<br />We’ll shape the rest.</h1></div>
        <p className="lead">Paste the complete advertisement. The agent will extract only what is stated and use your profile to prepare a first draft.</p>
      </header>
      {error && <div className="notice">{error}</div>}
      <div className="workspace">
        <section className="panel">
          <div className="panel-title"><h3>Job advertisement</h3><span className="step">Step 1</span></div>
          <div className="field">
            <label htmlFor="jobPost">Paste the full job post</label>
            <textarea id="jobPost" className="input" value={jobPost} onChange={(event) => setJobPost(event.target.value)} placeholder="Role title, company, location, responsibilities and requirements…" />
          </div>
          <button className="button wide" disabled={busy || jobPost.length < 80} onClick={analyse}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} {busy ? "Working…" : "Analyse job"}
          </button>
          <button className="button light wide" style={{ marginTop: 9 }} onClick={() => setJobPost(EXAMPLE)}>Use example post</button>
          <p className="helper">Tip: include the original source and URL when available. Unknown facts stay empty.</p>
        </section>

        <section className="panel">
          <div className="panel-title"><h3>Agent output</h3><span className="step">Step 2</span></div>
          {!result ? (
            <div className="empty"><div><FileSearch size={34} /><strong>Ready when you are</strong><p>Your structured job and tailored letter will appear here.</p></div></div>
          ) : (
            <>
              {result.mode === "demo" && <div className="notice" style={{ background: "#edf2d6", color: "#42553d" }}>Demo mode is active. Add a DeepSeek key for production-quality extraction and writing.</div>}
              <div className="result-grid">
                <div className="result-item"><small>Company</small><p>{result.companyName}</p></div>
                <div className="result-item"><small>Role</small><p>{result.jobTitle}</p></div>
                <div className="result-item"><small>Location</small><p>{result.location ?? "Not provided"}</p></div>
                <div className="result-item"><small>Source</small><p>{result.source}</p></div>
                <div className="result-item wide"><small>Summary</small><p>{result.jobSummary}</p></div>
                <div className="result-item wide"><small>Technology</small><div className="tags">{result.techStack.length ? result.techStack.map((item) => <span className="tag" key={item}>{item}</span>) : <span className="muted">None stated</span>}</div></div>
                <div className="result-item"><small>Responsibilities</small><ul className="result-list">{result.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div className="result-item"><small>Requirements</small><ul className="result-list">{result.requirements.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div className="result-item wide"><small>Cover letter</small><div className="cover-letter">{result.coverLetter}</div></div>
              </div>
              <div className="result-actions">
                <button className="button" disabled={busy || saved} onClick={save}>{saved ? <Check size={17} /> : <Save size={17} />}{saved ? "Saved" : "Save application"}</button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
