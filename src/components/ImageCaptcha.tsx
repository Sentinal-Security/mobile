import React, { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";

export type CaptchaTileKind =
  | "traffic_light"
  | "bicycle"
  | "bus"
  | "car"
  | "crosswalk"
  | "tree"
  | "building";

interface ImageChallenge {
  id: string;
  target: CaptchaTileKind;
  label: string;
  tiles: CaptchaTileKind[];
}

const CHALLENGE_POOL: ImageChallenge[] = [
  {
    id: "preset-traffic-lights",
    target: "traffic_light",
    label: "traffic lights",
    tiles: [
      "traffic_light",
      "car",
      "building",
      "bus",
      "traffic_light",
      "tree",
      "traffic_light",
      "bicycle",
      "crosswalk",
    ],
  },
  {
    id: "preset-bicycles",
    target: "bicycle",
    label: "bicycles",
    tiles: [
      "car",
      "bicycle",
      "tree",
      "bicycle",
      "bus",
      "traffic_light",
      "crosswalk",
      "bicycle",
      "building",
    ],
  },
  {
    id: "preset-buses",
    target: "bus",
    label: "buses",
    tiles: [
      "bus",
      "tree",
      "car",
      "traffic_light",
      "bus",
      "bicycle",
      "building",
      "bus",
      "bus",
    ],
  },
  {
    id: "preset-cars",
    target: "car",
    label: "cars",
    tiles: [
      "tree",
      "car",
      "bus",
      "crosswalk",
      "traffic_light",
      "car",
      "car",
      "building",
      "bicycle",
    ],
  },
  {
    id: "preset-crosswalks",
    target: "crosswalk",
    label: "crosswalks",
    tiles: [
      "crosswalk",
      "bicycle",
      "car",
      "building",
      "crosswalk",
      "bus",
      "tree",
      "traffic_light",
      "crosswalk",
    ],
  },
];

interface ThemeColorsLike {
  bgElevated: string;
  bgInput: string;
  borderSubtle: string;
  textPrimary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  successBorder: string;
  danger: string;
}

interface ImageCaptchaProps {
  verified: boolean;
  onVerifyChange: (verified: boolean) => void;
  challengeIndex: number;
  onCycleChallenge: () => void;
  themeColors: ThemeColorsLike;
}

function TileGlyph({ kind }: { kind: CaptchaTileKind }) {
  switch (kind) {
    case "traffic_light":
      return (
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 16,
              height: 30,
              borderRadius: 4,
              backgroundColor: "#1e293b",
              borderWidth: 1,
              borderColor: "#64748b",
              alignItems: "center",
              justifyContent: "space-evenly",
              paddingVertical: 2,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" }} />
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" }} />
          </View>
          <View style={{ width: 3, height: 6, backgroundColor: "#64748b" }} />
        </View>
      );
    case "bicycle":
      return (
        <View style={{ width: 36, height: 24, justifyContent: "flex-end", alignItems: "center" }}>
          <View
            style={{
              position: "absolute",
              top: 4,
              width: 16,
              height: 8,
              borderTopWidth: 2,
              borderLeftWidth: 2,
              borderRightWidth: 2,
              borderColor: "#cbd5e1",
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between", width: 34 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: "#38bdf8" }} />
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: "#38bdf8" }} />
          </View>
        </View>
      );
    case "bus":
      return (
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 28,
              height: 26,
              borderRadius: 4,
              backgroundColor: "#0284c7",
              borderWidth: 1.5,
              borderColor: "#7dd3fc",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 3,
            }}
          >
            <View style={{ width: 20, height: 9, borderRadius: 2, backgroundColor: "#e0f2fe" }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: 20 }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#fef08a" }} />
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#fef08a" }} />
            </View>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", width: 20 }}>
            <View style={{ width: 5, height: 3, backgroundColor: "#334155" }} />
            <View style={{ width: 5, height: 3, backgroundColor: "#334155" }} />
          </View>
        </View>
      );
    case "car":
      return (
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 20,
              height: 8,
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
              backgroundColor: "#475569",
              borderWidth: 1,
              borderColor: "#94a3b8",
            }}
          />
          <View
            style={{
              width: 34,
              height: 11,
              borderRadius: 3,
              backgroundColor: "#6366f1",
              borderWidth: 1,
              borderColor: "#a5b4fc",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              paddingHorizontal: 3,
            }}
          >
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#fef08a" }} />
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#fef08a" }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", width: 24, marginTop: -2 }}>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#0f172a", borderWidth: 1.5, borderColor: "#cbd5e1" }} />
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#0f172a", borderWidth: 1.5, borderColor: "#cbd5e1" }} />
          </View>
        </View>
      );
    case "crosswalk":
      return (
        <View
          style={{
            width: 34,
            height: 22,
            borderRadius: 3,
            backgroundColor: "#1e293b",
            borderWidth: 1,
            borderColor: "#475569",
            flexDirection: "row",
            justifyContent: "space-evenly",
            alignItems: "center",
            paddingHorizontal: 2,
          }}
        >
          <View style={{ width: 5, height: 14, backgroundColor: "#f8fafc", borderRadius: 1 }} />
          <View style={{ width: 5, height: 14, backgroundColor: "#f8fafc", borderRadius: 1 }} />
          <View style={{ width: 5, height: 14, backgroundColor: "#f8fafc", borderRadius: 1 }} />
          <View style={{ width: 5, height: 14, backgroundColor: "#f8fafc", borderRadius: 1 }} />
        </View>
      );
    case "tree":
      return (
        <View style={{ alignItems: "center" }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#15803d", borderWidth: 1.5, borderColor: "#4ade80" }} />
          <View style={{ width: 5, height: 9, backgroundColor: "#92400e", marginTop: -2 }} />
        </View>
      );
    case "building":
      return (
        <View
          style={{
            width: 24,
            height: 30,
            borderRadius: 2,
            backgroundColor: "#334155",
            borderWidth: 1,
            borderColor: "#64748b",
            padding: 4,
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ width: 5, height: 5, backgroundColor: "#94a3b8" }} />
            <View style={{ width: 5, height: 5, backgroundColor: "#94a3b8" }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ width: 5, height: 5, backgroundColor: "#94a3b8" }} />
            <View style={{ width: 5, height: 5, backgroundColor: "#94a3b8" }} />
          </View>
          <View style={{ width: 6, height: 7, backgroundColor: "#0f172a", alignSelf: "center" }} />
        </View>
      );
  }
}

export const IMAGE_CAPTCHA_POOL_LENGTH = CHALLENGE_POOL.length;

export function ImageCaptcha({
  verified,
  onVerifyChange,
  challengeIndex,
  onCycleChallenge,
  themeColors,
}: ImageCaptchaProps) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const safeIndex = ((challengeIndex % CHALLENGE_POOL.length) + CHALLENGE_POOL.length) % CHALLENGE_POOL.length;
  const challenge = CHALLENGE_POOL[safeIndex];

  const toggleTile = (idx: number) => {
    if (verified) return;
    setErrorMsg(null);
    setSelectedIndices((prev) =>
      prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx]
    );
  };

  const handleCycle = () => {
    setSelectedIndices([]);
    setErrorMsg(null);
    onVerifyChange(false);
    onCycleChallenge();
  };

  const handleVerify = () => {
    const expected = challenge.tiles
      .map((tile, idx) => (tile === challenge.target ? idx : -1))
      .filter((idx) => idx !== -1);
    const sorted = [...selectedIndices].sort((a, b) => a - b);

    const isMatch =
      expected.length === sorted.length &&
      expected.every((val, i) => val === sorted[i]);

    if (isMatch) {
      setErrorMsg(null);
      onVerifyChange(true);
    } else {
      setSelectedIndices([]);
      onVerifyChange(false);
      onCycleChallenge();
      setErrorMsg("Selection did not match. Try the next challenge.");
    }
  };

  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: verified ? themeColors.successBorder : themeColors.borderSubtle,
        backgroundColor: verified ? themeColors.successSoft : themeColors.bgElevated,
        padding: 12,
        marginBottom: 14,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: verified ? 0 : 8,
        }}
      >
        <Text
          style={{
            color: verified ? themeColors.success : themeColors.textPrimary,
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          {verified
            ? "HUMAN VERIFIED"
            : `SELECT ALL: ${challenge.label.toUpperCase()} (${safeIndex + 1}/${CHALLENGE_POOL.length})`}
        </Text>
        <TouchableOpacity onPress={handleCycle}>
          <Text style={{ color: themeColors.accent, fontSize: 11, fontWeight: "700" }}>
            NEW
          </Text>
        </TouchableOpacity>
      </View>

      {!verified && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 }}>
            {challenge.tiles.map((tile, idx) => {
              const isSelected = selectedIndices.includes(idx);
              return (
                <TouchableOpacity
                  key={`${challenge.id}-${idx}`}
                  onPress={() => toggleTile(idx)}
                  style={{
                    width: "31.5%",
                    height: 54,
                    borderRadius: 8,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? themeColors.accent : themeColors.borderSubtle,
                    backgroundColor: isSelected ? themeColors.accentSoft : themeColors.bgInput,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 4,
                  }}
                >
                  <TileGlyph kind={tile} />
                  {isSelected && (
                    <View
                      style={{
                        position: "absolute",
                        top: 3,
                        right: 4,
                        paddingHorizontal: 4,
                        paddingVertical: 1,
                        borderRadius: 4,
                        backgroundColor: themeColors.accent,
                      }}
                    >
                      <Text style={{ fontSize: 8, fontWeight: "800", color: "#020617" }}>OK</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={handleVerify}
            style={{
              marginTop: 8,
              backgroundColor: themeColors.accent,
              borderRadius: 8,
              paddingVertical: 9,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#020617", fontSize: 12, fontWeight: "800" }}>
              VERIFY SELECTION
            </Text>
          </TouchableOpacity>

          {errorMsg && (
            <Text style={{ color: themeColors.danger, fontSize: 11, marginTop: 6, fontWeight: "600" }}>
              {errorMsg}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
