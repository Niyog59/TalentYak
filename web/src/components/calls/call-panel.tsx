"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DailyCall, DailyEventObject, DailyParticipant } from "@daily-co/daily-js";
import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import { callClock, clockTime, countdown, joinRefusal, type CallTimes } from "@/lib/calls/window";

/**
 * The call for one session: a camera and microphone check, then the call.
 *
 * Nothing here decides who may join. The pass comes from the server, which
 * checks the person, the session and the time on every request; this screen
 * only asks for one and uses it. It never shows "connected" until the provider
 * says so, and every failure — a blocked camera, a dropped network, the call
 * service being down — says what happened and what can be done next.
 */

type Stage = "idle" | "checking" | "ready" | "joining" | "in_call" | "left" | "failed";
type DeviceProblem = "denied" | "missing" | "in_use" | "unsupported" | "no_answer" | "other" | null;
/** What the browser has let us use: both, the microphone only, or nothing (join to listen). */
type Access = "unknown" | "both" | "audio" | "none";

/** How long to wait for the browser's permission prompt before saying so. */
const PERMISSION_WAIT_MS = 12_000;
/** How long joining may take before it's reported as a failure rather than left spinning. */
const JOIN_WAIT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

/** The browser's remembered answer, where it will say (not every browser does). */
async function permissionState(name: "camera" | "microphone"): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

interface Devices {
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

const FATAL: Record<string, string> = {
  ejected: "You've been taken out of the call. That happens when the session is cancelled or moved, an account is suspended, or the room's time is up.",
  "exp-room": "The room for this session has closed.",
  "exp-token": "The join pass ran out before the call connected. Try again.",
  "nbf-room": "The room isn't open yet.",
  "no-room": "This session's room no longer exists. It may have been cancelled.",
  "meeting-full": "The room is full — it holds just the two of you. If the call is open in another tab or device, close it and try again.",
  "not-allowed": "The call service didn't let you in. Try again; if it keeps happening, tell TalentYak.",
  "connection-error": "The call couldn't connect. Your network or the call service may be having trouble.",
  "end-of-life": "This browser is too old for calls. Try a current version of Chrome, Safari, Edge or Firefox.",
  // The call provider refusing TalentYak's account (billing, limits). Nothing
  // the person did, and nothing they can fix — said plainly, not as a retry loop.
  "account-missing-payment-method": "The call service isn't available right now. This is on TalentYak's side, not yours — message the other person, arrange another time, or tell TalentYak below.",
};

function deviceProblem(err: unknown): DeviceProblem {
  const name = err instanceof Error || (typeof err === "object" && err && "name" in err) ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "in_use";
  return "other";
}

const DEVICE_HELP: Record<Exclude<DeviceProblem, null>, string> = {
  denied: "Your browser has blocked the camera or microphone for this site. Allow them in the site settings (the icon beside the address), then check again. You can also join audio-only, or join to listen.",
  missing: "No camera or microphone was found. Plug one in and check again, or join audio-only.",
  in_use: "Another app is using your camera or microphone. Close it (another call, a camera app) and check again.",
  unsupported: "This browser can't use a camera or microphone here. Try a current version of Chrome, Safari, Edge or Firefox.",
  no_answer: "Your browser hasn't let the call use your camera or microphone yet. Look for its prompt (near the address bar) and choose Allow, then check again. You can still join to listen.",
  other: "The camera or microphone couldn't be started. Check again, or join audio-only.",
};

function playable(p: DailyParticipant | undefined, kind: "video" | "audio"): MediaStreamTrack | null {
  const t = p?.tracks?.[kind];
  if (!t || t.state !== "playable") return null;
  return (t.persistentTrack ?? t.track) || null;
}

function MediaTile({ track, mirrored, muted, label, sub }: { track: MediaStreamTrack | null; mirrored?: boolean; muted?: boolean; label: string; sub?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
  }, [track]);
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-ink-deep text-white">
      {track ? (
        <video ref={ref} autoPlay playsInline muted={muted} className={`size-full object-cover ${mirrored ? "-scale-x-100" : ""}`} />
      ) : (
        <div className="grid place-items-center gap-2 p-4 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-brand text-2xl font-semibold" aria-hidden>{label.slice(0, 1).toUpperCase()}</span>
          {sub ? <span className="text-sm text-white/85">{sub}</span> : null}
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-sm">{label}</span>
    </div>
  );
}

function RemoteAudio({ track }: { track: MediaStreamTrack | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => undefined);
  }, [track]);
  return <audio ref={ref} autoPlay data-remote-audio />;
}

export function CallPanel({
  appointmentId,
  otherName,
  viewerTz,
  times,
  warningMinutes,
  bookAgainHref,
  messagesHref,
  reportSlot,
}: {
  appointmentId: string;
  otherName: string;
  viewerTz: string;
  times: CallTimes;
  warningMinutes: number[];
  bookAgainHref: string;
  messagesHref: string | null;
  /** The "report a call problem" form, rendered on the server. */
  reportSlot: ReactNode;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [audioOnly, setAudioOnly] = useState(false);
  const [problem, setProblem] = useState<DeviceProblem>(null);
  const [access, setAccess] = useState<Access>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<Devices>({ cameras: [], mics: [], speakers: [] });
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [speakerId, setSpeakerId] = useState("");
  const [local, setLocal] = useState<DailyParticipant | undefined>();
  const [remote, setRemote] = useState<DailyParticipant | undefined>();
  const [reconnecting, setReconnecting] = useState(false);
  const [weakNetwork, setWeakNetwork] = useState(false);
  const [wasHidden, setWasHidden] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const callRef = useRef<DailyCall | null>(null);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  // One clock for the whole panel, so every label agrees.
  // Starts after the first paint (the server has no clock to agree with).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const stopPreview = useCallback(() => {
    preview?.getTracks().forEach((t) => t.stop());
    setPreview(null);
    audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  }, [preview]);

  useEffect(() => {
    if (previewVideo.current) previewVideo.current.srcObject = preview;
  }, [preview]);

  // Leaving the page ends the call cleanly.
  useEffect(() => () => {
    callRef.current?.destroy().catch(() => undefined);
    callRef.current = null;
  }, []);

  // Phones pause the camera (and sometimes the microphone) when the browser
  // goes to the background. Say so when the person comes back.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && callRef.current) setWasHidden(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  async function listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      cameras: all.filter((d) => d.kind === "videoinput" && d.deviceId),
      mics: all.filter((d) => d.kind === "audioinput" && d.deviceId),
      speakers: all.filter((d) => d.kind === "audiooutput" && d.deviceId),
    });
  }

  async function check(opts: { audioOnly?: boolean } = {}) {
    const wantVideo = !(opts.audioOnly ?? audioOnly);
    setError(null);
    setProblem(null);
    stopPreview();
    setStage("checking");
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem("unsupported");
      setAccess("none");
      setStage("ready");
      return;
    }
    // A remembered "block" answers straight away, without waiting on a
    // request the browser will never grant.
    const [camState, micState] = await Promise.all([permissionState("camera"), permissionState("microphone")]);
    if (micState === "denied") {
      setProblem("denied");
      setAccess("none");
      setStage("ready");
      return;
    }
    const video = wantVideo && camState !== "denied";
    try {
      const got = await withTimeout(navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
        video: video ? (camId ? { deviceId: { exact: camId } } : { width: { ideal: 1280 }, height: { ideal: 720 } }) : false,
      }), PERMISSION_WAIT_MS);
      if (got === "timeout") {
        setProblem("no_answer");
        setAccess("unknown");
        setStage("ready");
        return;
      }
      const stream = got;
      setPreview(stream);
      setAccess(stream.getVideoTracks().length ? "both" : "audio");
      if (wantVideo && !video) {
        setAudioOnly(true);
        setProblem("denied");
      }
      await listDevices();
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && stream.getAudioTracks().length) {
        const ctx = new Ctx();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (audioCtx.current !== ctx) return;
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (err) {
      const p = deviceProblem(err);
      setAccess("none");
      // Camera refused or missing but the microphone may be fine: offer
      // audio-only rather than nothing.
      if (video && (p === "missing" || p === "in_use" || p === "denied")) {
        const audio = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true, video: false }), PERMISSION_WAIT_MS).catch(() => null);
        if (audio && audio !== "timeout") {
          setPreview(audio);
          setAudioOnly(true);
          setAccess("audio");
          await listDevices();
        }
      }
      setProblem(p);
    }
    setStage("ready");
  }

  function onParticipants(call: DailyCall) {
    const ps = call.participants();
    setLocal(ps.local);
    setRemote(Object.values(ps).find((p) => !p.local));
  }

  async function join() {
    setError(null);
    setStage("joining");
    stopPreview();
    let res: Response;
    let body: { ok?: boolean; reason?: string; roomUrl?: string; token?: string };
    try {
      res = await fetch(`/api/calls/${appointmentId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioOnly }),
        cache: "no-store",
      });
      body = await res.json();
    } catch {
      setError("You seem to be offline, or TalentYak couldn't be reached. Check your connection and try again.");
      setStage("failed");
      return;
    }
    if (!res.ok || !body.ok || !body.roomUrl || !body.token) {
      setError(joinRefusal(body.reason));
      setStage("failed");
      return;
    }

    try {
      const { default: Daily } = await import("@daily-co/daily-js");
      await callRef.current?.destroy().catch(() => undefined);
      // Without the microphone (blocked, missing, never answered) the person
      // joins to listen, rather than the join waiting on a device forever.
      const micState = access === "unknown" ? await permissionState("microphone") : "unknown";
      const noDevices = access === "none" || micState === "denied" || problem === "no_answer";
      const call = Daily.createCallObject({
        audioSource: noDevices ? false : micId || true,
        videoSource: noDevices || audioOnly || access === "audio" ? false : camId || true,
        dailyConfig: { avoidEval: true },
      });
      callRef.current = call;
      const update = () => onParticipants(call);
      call
        .on("joined-meeting", () => {
          update();
          setStage("in_call");
        })
        .on("participant-joined", update)
        .on("participant-updated", update)
        .on("participant-left", update)
        .on("track-started", update)
        .on("track-stopped", update)
        .on("left-meeting", () => {
          setLocal(undefined);
          setRemote(undefined);
          setReconnecting(false);
          setStage((s) => (s === "failed" ? s : "left"));
        })
        .on("network-connection", (e?: DailyEventObject<"network-connection">) => {
          if (e?.event === "interrupted") setReconnecting(true);
          if (e?.event === "connected") setReconnecting(false);
        })
        .on("network-quality-change", (e?: DailyEventObject<"network-quality-change">) => {
          setWeakNetwork(e?.threshold === "low" || e?.threshold === "very-low");
        })
        .on("camera-error", () => {
          setProblem("other");
          update();
        })
        .on("error", (e?: DailyEventObject<"error">) => {
          const type = (e?.error as { type?: string } | undefined)?.type || e?.errorMsg || "";
          setError(FATAL[type] ?? "The call ended unexpectedly. Try joining again.");
          setStage("failed");
          call.destroy().catch(() => undefined);
          callRef.current = null;
        });
      const joined = await withTimeout(call.join({ url: body.roomUrl, token: body.token, startVideoOff: audioOnly || noDevices, startAudioOff: noDevices }), JOIN_WAIT_MS);
      if (joined === "timeout") throw new Error("join timed out");
      if (noDevices) setProblem((p) => p ?? "no_answer");
      await call.enumerateDevices().then(({ devices: ds }) => setDevices({
        cameras: ds.filter((d) => d.kind === "videoinput"),
        mics: ds.filter((d) => d.kind === "audioinput"),
        speakers: ds.filter((d) => d.kind === "audiooutput"),
      })).catch(() => undefined);
    } catch {
      setError((e) => e ?? "The call couldn't connect. Your network or the call service may be having trouble.");
      setStage("failed");
      await callRef.current?.destroy().catch(() => undefined);
      callRef.current = null;
    }
  }

  async function leave() {
    await callRef.current?.leave().catch(() => undefined);
    await callRef.current?.destroy().catch(() => undefined);
    callRef.current = null;
    setStage("left");
  }

  const call = callRef.current;
  // "On" only when something is actually being sent — a blocked or missing
  // device reads as off, so the button offers to turn it on.
  const sending = (state?: string) => state === "playable" || state === "sendable" || state === "loading";
  const micOn = sending(local?.tracks?.audio?.state);
  const camOn = sending(local?.tracks?.video?.state);
  const canPickSpeaker = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  if (now === null) {
    return <p className="text-ink-muted">Loading the call…</p>;
  }
  const clock = callClock(now, times, warningMinutes);
  const closeAt = clockTime(times.closesAt, viewerTz);

  const clockLine = (() => {
    switch (clock.phase) {
      case "before": return `The room opens at ${clockTime(times.opensAt, viewerTz)} — in ${countdown(clock.msToNext)}.`;
      case "open_early": return `The room is open. The session starts in ${countdown(clock.msToNext)}.`;
      case "in_session": return `${countdown(clock.msToNext)} left of the booked time.`;
      case "overtime": return `The booked time has ended. The room stays open until ${closeAt} if you need to finish.`;
      case "closed": return "The room for this session has closed.";
    }
  })();

  const inCall = stage === "in_call";

  return (
    <div className="grid gap-4">
      <p className="flex items-start gap-2 font-medium" aria-live="off">
        <Icon name="clock" className="mt-0.5 size-5 shrink-0 text-brand" />
        <span>{clockLine}</span>
      </p>

      {clock.warningMinutes !== null && (inCall || clock.phase === "overtime") ? (
        <p role="status" className="rounded-lg border border-line bg-accent-tint p-3 font-semibold">
          The room closes at {closeAt} — in {countdown(clock.msToClose)}. Wrap up, or book another time if you need longer.
        </p>
      ) : null}

      {inCall ? (
        <div className="grid gap-3">
          {reconnecting ? (
            <p role="status" className="rounded-lg border border-line bg-accent-tint p-3 font-semibold">Connection lost — reconnecting… Stay on this page.</p>
          ) : null}
          {weakNetwork && !reconnecting ? (
            <p role="status" className="rounded-lg border border-line bg-paper-raised p-3">
              Your connection is weak. Turning your camera off usually helps.{" "}
              {camOn ? <button type="button" className="font-semibold text-brand underline underline-offset-4" onClick={() => call?.setLocalVideo(false)}>Turn camera off</button> : null}
            </p>
          ) : null}
          {wasHidden ? (
            <p role="status" className="rounded-lg border border-line bg-paper-raised p-3">
              Welcome back. Phones can pause the camera or microphone while the browser is in the background — if they did, turn them back on below.{" "}
              <button type="button" className="font-semibold text-brand underline underline-offset-4" onClick={() => setWasHidden(false)}>OK</button>
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            {remote ? (
              <MediaTile track={playable(remote, "video")} label={otherName} sub={playable(remote, "audio") ? "Camera off" : "Camera and microphone off"} />
            ) : (
              <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed border-line-strong bg-paper-raised p-4 text-center" role="status">
                <p>
                  <span className="block font-semibold">Waiting for {otherName}</span>
                  <span className="text-ink-muted">You&rsquo;re in the room. They&rsquo;ll appear here when they join.</span>
                </p>
              </div>
            )}
            <MediaTile track={playable(local, "video")} mirrored muted label="You" sub={micOn ? "Camera off" : "Camera and microphone off"} />
          </div>
          <RemoteAudio track={playable(remote, "audio")} />

          <div className="flex flex-wrap gap-2" role="group" aria-label="Call controls">
            <Button type="button" variant={micOn ? "secondary" : "primary"} onClick={() => call?.setLocalAudio(!micOn)} aria-pressed={!micOn}>
              <Icon name="audio" /> {micOn ? "Mute" : "Unmute"}
            </Button>
            <Button type="button" variant={camOn ? "secondary" : "primary"} onClick={() => call?.setLocalVideo(!camOn)} aria-pressed={!camOn}>
              <Icon name="video" /> {camOn ? "Camera off" : "Camera on"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowDevices((v) => !v)} aria-expanded={showDevices}>
              <Icon name="camera" /> Devices
            </Button>
            <Button type="button" variant="secondary" onClick={leave} className="border-danger text-danger">
              Leave call
            </Button>
          </div>

          {showDevices ? (
            <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-3">
              <DeviceSelect label="Camera" devices={devices.cameras} value={camId} onChange={(id) => { setCamId(id); call?.setInputDevicesAsync({ videoDeviceId: id }).catch(() => setProblem("in_use")); }} />
              <DeviceSelect label="Microphone" devices={devices.mics} value={micId} onChange={(id) => { setMicId(id); call?.setInputDevicesAsync({ audioDeviceId: id }).catch(() => setProblem("in_use")); }} />
              {canPickSpeaker && devices.speakers.length ? (
                <DeviceSelect label="Speaker" devices={devices.speakers} value={speakerId} onChange={(id) => { setSpeakerId(id); call?.setOutputDeviceAsync({ outputDeviceId: id }).catch(() => undefined); }} />
              ) : (
                <p className="text-sm text-ink-muted">This browser uses the system speaker. Change it in your device&rsquo;s sound settings.</p>
              )}
            </div>
          ) : null}
          {problem ? <p role="alert" className="rounded-lg border border-danger bg-danger-tint p-3">{DEVICE_HELP[problem]}</p> : null}
        </div>
      ) : clock.canJoin ? (
        <div className="grid gap-4">
          {stage === "left" ? <p role="status" className="rounded-lg bg-paper-raised p-3">You&rsquo;ve left the call. You can rejoin while the room is open.</p> : null}
          {error ? <p role="alert" className="rounded-lg border border-danger bg-danger-tint p-3 font-medium">{error}</p> : null}

          {preview ? (
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr] sm:items-start">
              {preview.getVideoTracks().length ? (
                <video ref={previewVideo} autoPlay playsInline muted className="aspect-video w-full rounded-xl bg-ink-deep object-cover -scale-x-100" aria-label="Your camera preview" />
              ) : (
                <div className="grid aspect-video w-full place-items-center rounded-xl bg-paper-raised p-4 text-center">Audio only — your camera won&rsquo;t be used.</div>
              )}
              <div className="grid gap-3">
                <div>
                  <p className="font-semibold">Microphone</p>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-paper-raised" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                    <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(level * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">Say something — the bar should move.</p>
                </div>
                {devices.cameras.length > 1 && !audioOnly ? <DeviceSelect label="Camera" devices={devices.cameras} value={camId} onChange={(id) => { setCamId(id); }} /> : null}
                {devices.mics.length > 1 ? <DeviceSelect label="Microphone" devices={devices.mics} value={micId} onChange={(id) => { setMicId(id); }} /> : null}
                {(camId || micId) ? <Button type="button" variant="secondary" size="sm" onClick={() => check()}>Use these devices</Button> : null}
              </div>
            </div>
          ) : null}
          {problem ? <p role="alert" className="rounded-lg border border-danger bg-danger-tint p-3">{DEVICE_HELP[problem]}</p> : null}

          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5 accent-brand" checked={audioOnly} onChange={(e) => { setAudioOnly(e.target.checked); if (preview) void check({ audioOnly: e.target.checked }); }} />
            <span>Audio only <span className="text-ink-muted">— uses much less data; your camera stays off</span></span>
          </label>

          <div className="flex flex-wrap gap-3">
            {stage !== "checking" && stage !== "joining" ? (
              <Button type="button" variant="secondary" onClick={() => check()}>
                <Icon name="camera" /> {preview ? "Check again" : "Check camera and microphone"}
              </Button>
            ) : null}
            <Button type="button" onClick={join} disabled={stage === "joining" || stage === "checking"} aria-disabled={stage === "joining" || stage === "checking"}>
              <Icon name={audioOnly ? "audio" : "video"} />
              {stage === "joining" ? "Joining…" : stage === "left" || stage === "failed" ? "Rejoin the call" : "Join the call"}
            </Button>
          </div>
          <p className="text-sm text-ink-muted">Private to you and {otherName}. Nothing is recorded.</p>
        </div>
      ) : stage === "failed" && error ? (
        <p role="alert" className="rounded-lg border border-danger bg-danger-tint p-3 font-medium">{error}</p>
      ) : null}

      <details className="rounded-xl border border-line p-4" open={stage === "failed"}>
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Having trouble with the call?</summary>
        <ul className="mt-3 grid gap-2">
          {clock.canJoin && !inCall ? <li>Try joining again — a fresh connection often fixes it. Audio only helps on a weak connection.</li> : null}
          {messagesHref ? <li><Link className="font-semibold text-brand underline underline-offset-4" href={messagesHref}>Message {otherName}</Link> to agree what to do.</li> : null}
          <li><Link className="font-semibold text-brand underline underline-offset-4" href={bookAgainHref}>Arrange another time</Link> if you couldn&rsquo;t meet.</li>
          <li>Tell TalentYak below. A technical problem is never counted against you, and never counts as a delivered session.</li>
        </ul>
        <div className="mt-4">{reportSlot}</div>
      </details>
    </div>
  );
}

function DeviceSelect({ label, devices, value, onChange }: { label: string; devices: MediaDeviceInfo[]; value: string; onChange: (id: string) => void }) {
  const id = `device-${label.toLowerCase()}`;
  if (!devices.length) return null;
  return (
    <div>
      <label htmlFor={id} className="block font-semibold">{label}</label>
      <select id={id} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Default</option>
        {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
      </select>
    </div>
  );
}
