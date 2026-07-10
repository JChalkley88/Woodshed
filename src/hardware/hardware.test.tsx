import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
} from "./index.ts";

describe("Knob", () => {
  it("exposes slider semantics", () => {
    render(
      <Knob value={2} min={-6} max={6} default={0} label="Pitch" onChange={() => {}} />,
    );
    const knob = screen.getByRole("slider", { name: "Pitch" });
    expect(knob).toHaveAttribute("aria-valuenow", "2");
    expect(knob).toHaveAttribute("aria-valuemin", "-6");
    expect(knob).toHaveAttribute("aria-valuemax", "6");
  });

  it("steps with arrow keys when focused", async () => {
    const onChange = vi.fn();
    render(
      <Knob value={0} min={0} max={10} default={5} label="Gain" step={1} onChange={onChange} />,
    );
    const knob = screen.getByRole("slider", { name: "Gain" });
    knob.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("resets to default on double-click", async () => {
    const onChange = vi.fn();
    render(
      <Knob value={9} min={0} max={10} default={5} label="Gain" onChange={onChange} />,
    );
    await userEvent.dblClick(screen.getByRole("slider", { name: "Gain" }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("renders the 11-tick skirt", () => {
    const { container } = render(
      <Knob value={0} min={0} max={10} default={5} label="Gain" onChange={() => {}} />,
    );
    expect(container.querySelectorAll(".hw-knob-tick")).toHaveLength(11);
  });
});

describe("Fader", () => {
  it("announces its level in decibels", () => {
    render(<Fader value={-5} label="Bass" onChange={() => {}} />);
    const fader = screen.getByRole("slider", { name: "Bass fader" });
    expect(fader).toHaveAttribute("aria-valuetext", "-5 decibels");
  });

  it("double-click returns to unity", async () => {
    const onChange = vi.fn();
    render(<Fader value={-20} label="Bass" onChange={onChange} />);
    await userEvent.dblClick(screen.getByRole("slider", { name: "Bass fader" }));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall![0]).toBeCloseTo(0, 4);
  });

  it("shows the dB scale including the infinity mark", () => {
    const { container } = render(<Fader value={0} label="Bass" onChange={() => {}} />);
    expect(container.querySelector(".hw-fader-scale")?.textContent).toContain("-∞");
  });
});

describe("TempoFader", () => {
  it("covers 50 to 120 percent", () => {
    render(<TempoFader value={75} onChange={() => {}} />);
    const fader = screen.getByRole("slider", { name: "Tempo" });
    expect(fader).toHaveAttribute("aria-valuemin", "50");
    expect(fader).toHaveAttribute("aria-valuemax", "120");
    expect(fader).toHaveAttribute("aria-valuetext", "75 percent speed");
  });

  it("steps by whole percent with arrows", async () => {
    const onChange = vi.fn();
    render(<TempoFader value={75} onChange={onChange} />);
    screen.getByRole("slider", { name: "Tempo" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith(74);
  });

  it("marks the machined zero line", () => {
    const { container } = render(<TempoFader value={75} onChange={() => {}} />);
    expect(container.querySelector(".hw-fader-zero")).toBeInTheDocument();
  });
});

describe("HardwareButton", () => {
  it("latches on click", async () => {
    const onChange = vi.fn();
    render(<HardwareButton label="MUTE" led="red" on={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "MUTE" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects latched state for assistive tech and LED", () => {
    const { container } = render(
      <HardwareButton label="SOLO" led="amber" on={true} onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "SOLO" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(container.querySelector(".hw-btn-on.hw-btn-amber")).toBeInTheDocument();
  });
});

describe("LEDMeter", () => {
  const litSegments = (container: HTMLElement) =>
    container.querySelectorAll(".hw-seg-green, .hw-seg-amber, .hw-seg-red");

  it("is dark at zero", () => {
    const { container } = render(<LEDMeter level={0} />);
    expect(litSegments(container)).toHaveLength(0);
    expect(container.querySelectorAll(".hw-seg")).toHaveLength(14);
  });

  it("lights green only at moderate levels", () => {
    const { container } = render(<LEDMeter level={9 / 14} />);
    expect(container.querySelectorAll(".hw-seg-green")).toHaveLength(9);
    expect(container.querySelectorAll(".hw-seg-amber")).toHaveLength(0);
  });

  it("reaches red at full scale", () => {
    const { container } = render(<LEDMeter level={1} />);
    expect(container.querySelectorAll(".hw-seg-green")).toHaveLength(9);
    expect(container.querySelectorAll(".hw-seg-amber")).toHaveLength(3);
    expect(container.querySelectorAll(".hw-seg-red")).toHaveLength(2);
  });
});

describe("LCD", () => {
  it("renders variants", () => {
    const { container } = render(
      <LCD variant="time" ariaLabel="Elapsed time">
        01:42.6
      </LCD>,
    );
    expect(container.querySelector(".hw-lcd-time")).toHaveTextContent("01:42.6");
  });

  it("renders chord chips as written, with states", () => {
    const { container } = render(
      <LCD variant="chords">
        <LCDChord state="past">Dm7</LCDChord>
        <LCDChord state="now">Bb</LCDChord>
        <LCDChord>C</LCDChord>
      </LCD>,
    );
    expect(container.querySelector(".hw-chord-past")).toHaveTextContent("Dm7");
    expect(container.querySelector(".hw-chord-now")).toHaveTextContent("Bb");
  });
});

describe("ScribbleStrip", () => {
  it("edits on click and commits on Enter", async () => {
    const onChange = vi.fn();
    render(<ScribbleStrip id="s1" value="vox" onChange={onChange} />);
    await userEvent.click(screen.getByText("vox"));
    const input = screen.getByRole("textbox", { name: "Scribble strip label" });
    await userEvent.clear(input);
    await userEvent.type(input, "learn this!{Enter}");
    expect(onChange).toHaveBeenCalledWith("learn this!");
  });

  it("caps input at 24 characters", async () => {
    render(<ScribbleStrip id="s2" value="vox" onChange={() => {}} />);
    await userEvent.click(screen.getByText("vox"));
    expect(
      screen.getByRole("textbox", { name: "Scribble strip label" }),
    ).toHaveAttribute("maxlength", "24");
  });

  it("abandons the edit on Escape", async () => {
    const onChange = vi.fn();
    render(<ScribbleStrip id="s3" value="vox" onChange={onChange} />);
    await userEvent.click(screen.getByText("vox"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Scribble strip label" }),
      "nope{Escape}",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("vox")).toBeInTheDocument();
  });
});

describe("Transport", () => {
  it("labels play/pause by state", () => {
    const { rerender } = render(
      <Transport
        playing={false}
        loopEngaged={false}
        onPlayPause={() => {}}
        onRewind={() => {}}
        onLoopToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    rerender(
      <Transport
        playing={true}
        loopEngaged={false}
        onPlayPause={() => {}}
        onRewind={() => {}}
        onLoopToggle={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("lights the loop lamp only when engaged", () => {
    const { rerender } = render(
      <Transport
        playing={false}
        loopEngaged={false}
        onPlayPause={() => {}}
        onRewind={() => {}}
        onLoopToggle={() => {}}
      />,
    );
    expect(screen.getByTestId("loop-lamp")).not.toHaveClass("hw-looplamp-on");
    rerender(
      <Transport
        playing={false}
        loopEngaged={true}
        onPlayPause={() => {}}
        onRewind={() => {}}
        onLoopToggle={() => {}}
      />,
    );
    expect(screen.getByTestId("loop-lamp")).toHaveClass("hw-looplamp-on");
    expect(screen.getByRole("button", { name: "Toggle loop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("fires the callbacks", async () => {
    const onPlayPause = vi.fn();
    const onRewind = vi.fn();
    render(
      <Transport
        playing={false}
        loopEngaged={false}
        onPlayPause={onPlayPause}
        onRewind={onRewind}
        onLoopToggle={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    await userEvent.click(screen.getByRole("button", { name: "Return to start" }));
    expect(onPlayPause).toHaveBeenCalledOnce();
    expect(onRewind).toHaveBeenCalledOnce();
  });
});
