import React, { useState } from "react";
import { Image, ImageSourcePropType, Text, TouchableOpacity, View } from "react-native";

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

const TILE_IMAGES: Record<CaptchaTileKind, ImageSourcePropType> = {
  traffic_light: require("../../assets/captcha/traffic_light.jpg"),
  bicycle: require("../../assets/captcha/bicycle.jpg"),
  bus: require("../../assets/captcha/bus.jpg"),
  car: require("../../assets/captcha/car.jpg"),
  crosswalk: require("../../assets/captcha/crosswalk.jpg"),
  tree: require("../../assets/captcha/tree.jpg"),
  building: require("../../assets/captcha/building.jpg"),
};

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

  const isExactMatch = (indices: number[]) => {
    const expected = challenge.tiles
      .map((tile, idx) => (tile === challenge.target ? idx : -1))
      .filter((idx) => idx !== -1);
    const sorted = [...indices].sort((a, b) => a - b);
    return (
      expected.length === sorted.length &&
      expected.every((val, i) => val === sorted[i])
    );
  };

  const toggleTile = (idx: number) => {
    if (verified) return;
    setErrorMsg(null);
    const next = selectedIndices.includes(idx)
      ? selectedIndices.filter((item) => item !== idx)
      : [...selectedIndices, idx];
    setSelectedIndices(next);
    if (isExactMatch(next)) {
      onVerifyChange(true);
    }
  };

  const handleCycle = () => {
    setSelectedIndices([]);
    setErrorMsg(null);
    onVerifyChange(false);
    onCycleChallenge();
  };

  const handleVerify = () => {
    if (isExactMatch(selectedIndices)) {
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
                    height: 68,
                    borderRadius: 8,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? themeColors.accent : themeColors.borderSubtle,
                    backgroundColor: themeColors.bgInput,
                    overflow: "hidden",
                    marginBottom: 4,
                  }}
                >
                  <Image
                    source={TILE_IMAGES[tile]}
                    style={{
                      width: "100%",
                      height: "100%",
                      opacity: isSelected ? 0.78 : 1,
                    }}
                    resizeMode="cover"
                  />
                  {isSelected && (
                    <View
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        paddingHorizontal: 5,
                        paddingVertical: 1,
                        borderRadius: 4,
                        backgroundColor: themeColors.accent,
                      }}
                    >
                      <Text style={{ fontSize: 9, fontWeight: "800", color: "#020617" }}>OK</Text>
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
