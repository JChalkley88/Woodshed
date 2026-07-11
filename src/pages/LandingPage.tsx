import { Link } from "react-router-dom";
import "../studio/landing.css";

/** The landing page: sells the product honestly in the desk's material
 *  language. No overclaiming, chords presented as beta, privacy first. */
export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <div className="landing-brand">
          <span className="landing-name">Woodshed</span>
          <span className="landing-model">W-4S practice console</span>
        </div>
        <h1 className="landing-strap">
          Split any song into stems. Slow it down. Loop the hard bars.
          All on your own machine.
        </h1>
        <p className="landing-sub">
          Woodshed is a practice studio that runs entirely in your browser.
          Drop in a song, pull the vocals, drums, bass, and the rest apart,
          then practise your part at your tempo and pitch. Your audio never
          leaves your device.
        </p>
        <Link to="/studio" className="landing-cta" data-testid="open-studio">
          Open the studio
        </Link>
        <p className="landing-cta-note">
          Free to try with a full desk. Stem export and chord detection
          take a one-time licence.
        </p>
      </header>

      <section className="landing-panel">
        <div className="landing-demo" aria-label="Demo film placeholder">
          <span className="landing-demo-text">DEMO FILM COMING SOON</span>
        </div>
      </section>

      <section className="landing-panel">
        <h2 className="landing-h2">What is on the desk</h2>
        <ul className="landing-features">
          <li>
            <strong>Stem separation.</strong> Four stems (vocals, drums,
            bass, everything else) from any mp3, wav, m4a, or flac, computed
            on your machine by a neural model. Separated once, cached, then
            instant every time after.
          </li>
          <li>
            <strong>A real mixer.</strong> Per-stem faders, mute, and solo
            with proper solo-group behaviour, live meters, and editable tape
            scribble strips.
          </li>
          <li>
            <strong>Practice transport.</strong> A-B looping with a saved
            loop bank, tempo from 50 to 120 percent without changing pitch,
            and pitch shift of six semitones either way without changing
            speed.
          </li>
          <li>
            <strong>Chord detection (beta).</strong> A chord lane synced to
            playback. It reads sparse and acoustic material well and
            struggles on dense full-band mixes; it is labelled beta because
            that is what it is.
          </li>
          <li>
            <strong>Stem export.</strong> Licensed desks export stems as
            16 or 24 bit WAV, singly or zipped.
          </li>
        </ul>
      </section>

      <section className="landing-panel">
        <h2 className="landing-h2">Private by construction</h2>
        <p className="landing-copy">
          There is no upload. The separation model downloads to your browser
          once (about 158 MB, with progress shown honestly), and every note
          of your music is processed on your own hardware. No account, no
          analytics on your audio, nothing sent anywhere. After the first
          visit the whole studio works offline.
        </p>
      </section>

      <section className="landing-panel">
        <h2 className="landing-h2">One price, no subscription</h2>
        <p className="landing-copy">
          The core desk is free: separation, mixing, solo, loops, tempo, and
          pitch. A one-time licence unlocks stem export and chord detection
          on your machine, for good. No renewals, no seats, no tiers.
        </p>
      </section>

      <section className="landing-panel">
        <h2 className="landing-h2">Straight answers</h2>
        <dl className="landing-faq">
          <dt>How long does separation take?</dt>
          <dd>
            It depends on your hardware. A machine with modern graphics
            acceleration (WebGPU) separates a four-minute song in a few
            minutes; without it, the processor path works too and takes
            longer. Either way it happens once per song, with honest
            progress and a time estimate, and the result is cached.
          </dd>
          <dt>Does it work offline?</dt>
          <dd>
            Yes. After your first visit the app, the model, and your
            separated songs are stored locally. Practice does not need a
            connection.
          </dd>
          <dt>Why is it dark?</dt>
          <dd>
            Woodshed is modelled on studio hardware, and it ships dark
            only. That is a design decision, not a missing feature.
          </dd>
          <dt>Can I use it on my phone?</dt>
          <dd>
            It is built for a desktop or laptop. Small screens get a polite
            note instead of a cramped desk.
          </dd>
          <dt>Which browsers?</dt>
          <dd>
            Chrome and Edge give the fastest separation. Firefox and Safari
            run the processor path, which is slower but produces identical
            results. The desk tells you which path you are on.
          </dd>
        </dl>
      </section>

      <footer className="landing-footer">
        <span>All processing on this device — nothing uploaded</span>
        <span>Wantage · Oxfordshire</span>
      </footer>
    </div>
  );
}
