import { useEffect, useState, type ReactNode } from "react";
import { meterBallistics } from "../audio/maths.ts";
import {
  Fader,
  HardwareButton,
  Knob,
  LCD,
  LCDChord,
  LEDMeter,
  ScribbleStrip,
  TempoFader,
  Transport,
} from "../hardware/index.ts";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2
        className="label mb-4"
        style={{ fontSize: 11, color: "var(--engrave)" }}
      >
        {title}
      </h2>
      <div className="flex flex-wrap items-end gap-10">{children}</div>
    </section>
  );
}

function Case({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      {children}
      <div className="label" style={{ color: "var(--engrave-faint)" }}>
        {caption}
      </div>
    </div>
  );
}

/** A meter running the real ballistics against a wandering target, so the
 *  attack/release behaviour is visible on the QA page. */
function AnimatedMeter() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let raf = 0;
    let current = 0;
    let target = 0.6;
    let frame = 0;
    const tick = () => {
      if (frame % 9 === 0) target = 0.25 + Math.random() * 0.7;
      current = meterBallistics(current, target);
      setLevel(current);
      frame++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <LEDMeter level={level} label="animated" />;
}

/** Visual QA route for the hardware library: every component in every state,
 *  spec section 4. Interactive controls are live so drag, wheel, keyboard,
 *  and double-click behaviour can be checked by hand. */
export default function HardwarePage() {
  const [knobValue, setKnobValue] = useState(0);
  const [faderDb, setFaderDb] = useState(0);
  const [tempo, setTempo] = useState(75);
  const [mute, setMute] = useState(false);
  const [solo, setSolo] = useState(false);
  const [scribble, setScribble] = useState("learn this!");
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);

  return (
    <main
      className="mx-auto max-w-[1160px] p-8"
      style={{
        background:
          "linear-gradient(180deg, var(--panel-hi) 0, var(--panel) 12%, var(--panel) 88%, var(--panel-lo) 100%)",
        borderRadius: 4,
        margin: "24px auto",
        boxShadow: "0 14px 40px rgba(0,0,0,0.8)",
      }}
    >
      <h1
        className="mb-8"
        style={{
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: "var(--plate-ink)",
        }}
      >
        Woodshed hardware QA
      </h1>

      <Section title="4.1 Knob">
        <Case caption="Interactive (drag / wheel / keys / dbl-click)">
          <Knob
            value={knobValue}
            min={-6}
            max={6}
            default={0}
            label="Pitch"
            onChange={setKnobValue}
            valueText={`${Math.round(knobValue)} semitones`}
          />
        </Case>
        <Case caption="Minimum (-135°)">
          <Knob value={0} min={0} max={10} default={5} label="Min" onChange={() => {}} />
        </Case>
        <Case caption="Centre (0°)">
          <Knob value={5} min={0} max={10} default={5} label="Centre" onChange={() => {}} />
        </Case>
        <Case caption="Maximum (+135°)">
          <Knob value={10} min={0} max={10} default={5} label="Max" onChange={() => {}} />
        </Case>
      </Section>

      <Section title="4.2 Channel fader">
        <Case caption="Interactive (dbl-click = unity)">
          <Fader value={faderDb} label="Channel" onChange={setFaderDb} />
        </Case>
        <Case caption="+10 (top)">
          <Fader value={10} label="Top" onChange={() => {}} />
        </Case>
        <Case caption="Unity 0dB">
          <Fader value={0} label="Unity" onChange={() => {}} />
        </Case>
        <Case caption="-20dB">
          <Fader value={-20} label="Low" onChange={() => {}} />
        </Case>
        <Case caption="-∞ (bottom)">
          <Fader value={-Infinity} label="Silent" onChange={() => {}} />
        </Case>
      </Section>

      <Section title="4.3 Tempo fader">
        <Case caption="Interactive (dbl-click = 100%)">
          <div className="flex flex-col items-center gap-3">
            <TempoFader value={tempo} onChange={setTempo} />
            <LCD variant="readout" ariaLabel="Tempo readout">
              {Math.round(tempo)}%
            </LCD>
          </div>
        </Case>
        <Case caption="50%">
          <TempoFader value={50} onChange={() => {}} />
        </Case>
        <Case caption="100% (on the zero line)">
          <TempoFader value={100} onChange={() => {}} />
        </Case>
        <Case caption="120%">
          <TempoFader value={120} onChange={() => {}} />
        </Case>
      </Section>

      <Section title="4.4 Buttons">
        <Case caption="MUTE off / on (latching)">
          <div className="flex gap-2">
            <HardwareButton label="MUTE" led="red" on={mute} onChange={setMute} />
            <HardwareButton label="MUTE" led="red" on={true} onChange={() => {}} />
          </div>
        </Case>
        <Case caption="SOLO off / on (latching)">
          <div className="flex gap-2">
            <HardwareButton label="SOLO" led="amber" on={solo} onChange={setSolo} />
            <HardwareButton label="SOLO" led="amber" on={true} onChange={() => {}} />
          </div>
        </Case>
        <Case caption="Pressed state: hold any button down">
          <HardwareButton label="MUTE" led="red" on={false} onChange={() => {}} />
        </Case>
      </Section>

      <Section title="4.5 LED meter">
        <Case caption="Off">
          <LEDMeter level={0} />
        </Case>
        <Case caption="Green (segment 7)">
          <LEDMeter level={0.5} />
        </Case>
        <Case caption="Amber (segment 12)">
          <LEDMeter level={0.85} />
        </Case>
        <Case caption="Full / clip (segment 14)">
          <LEDMeter level={1} />
        </Case>
        <Case caption="Live ballistics (attack .25, release .08)">
          <AnimatedMeter />
        </Case>
      </Section>

      <Section title="4.6 LCD">
        <Case caption="Time counter (30px)">
          <LCD variant="time" ariaLabel="Elapsed time">
            01:42.6
          </LCD>
        </Case>
        <Case caption="Tempo readout (14px)">
          <LCD variant="readout">75%</LCD>
        </Case>
        <Case caption="Pitch readout (14px)">
          <LCD variant="readout">0 st</LCD>
        </Case>
        <Case caption="Loop in/out (12px, two lines)">
          <LCD variant="loop">
            IN&nbsp;&nbsp;01:28.4
            <br />
            OUT&nbsp;01:56.2
          </LCD>
        </Case>
        <Case caption="Locked paid feature (spec section 7)">
          <LCD variant="readout">LOCKED</LCD>
        </Case>
        <Case caption="Chord lane: past / current / upcoming">
          <div style={{ width: 420 }}>
            <LCD variant="chords" ariaLabel="Chord lane">
              <LCDChord state="past">Dm</LCDChord>
              <LCDChord state="past">Dm7</LCDChord>
              <LCDChord state="past">G</LCDChord>
              <LCDChord state="now">A7</LCDChord>
              <LCDChord>Dm</LCDChord>
              <LCDChord>Bb</LCDChord>
              <LCDChord>C</LCDChord>
            </LCD>
          </div>
        </Case>
      </Section>

      <Section title="4.7 Scribble strip">
        <Case caption="Click to edit (24 char max, in-memory tonight)">
          <div style={{ width: 120 }}>
            <ScribbleStrip id="qa-1" value={scribble} onChange={setScribble} />
          </div>
        </Case>
        <Case caption="Default stem name">
          <div style={{ width: 120 }}>
            <ScribbleStrip id="qa-2" value="vox" onChange={() => {}} />
          </div>
        </Case>
        <Case caption="Long label">
          <div style={{ width: 160 }}>
            <ScribbleStrip id="qa-3" value="gtr + keys (bridge only)" onChange={() => {}} />
          </div>
        </Case>
      </Section>

      <Section title="4.8 Transport">
        <Case caption="Interactive: stopped / playing, loop lamp blinks">
          <Transport
            playing={playing}
            loopEngaged={loop}
            onPlayPause={() => setPlaying((p) => !p)}
            onRewind={() => {}}
            onLoopToggle={() => setLoop((l) => !l)}
          />
        </Case>
        <Case caption="Playing, loop off">
          <Transport
            playing={true}
            loopEngaged={false}
            onPlayPause={() => {}}
            onRewind={() => {}}
            onLoopToggle={() => {}}
          />
        </Case>
      </Section>
    </main>
  );
}
