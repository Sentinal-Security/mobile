import React, { useState } from "react";
import { Image, ImageSourcePropType, Text, TouchableOpacity, View } from "react-native";

export type TileCategory =
  | "traffic_light"
  | "bicycle"
  | "bus"
  | "car"
  | "crosswalk"
  | "tree"
  | "building";

type TilePhotoId =
  | "traffic_light_1"
  | "traffic_light_2"
  | "traffic_light_3"
  | "bicycle_1"
  | "bicycle_2"
  | "bicycle_3"
  | "bus_1"
  | "bus_2"
  | "bus_3"
  | "bus_4"
  | "car_1"
  | "car_2"
  | "car_3"
  | "crosswalk_1"
  | "crosswalk_2"
  | "crosswalk_3"
  | "tree_1"
  | "tree_2"
  | "building_1"
  | "building_2";

interface CaptchaTile {
  photo: TilePhotoId;
  category: TileCategory;
}

interface ImageChallenge {
  id: string;
  target: TileCategory;
  label: string;
  tiles: CaptchaTile[];
}

const CHALLENGE_POOL: ImageChallenge[] = [
  {
    id: "preset-traffic-lights",
    target: "traffic_light",
    label: "traffic lights",
    tiles: [
      { photo: "traffic_light_1", category: "traffic_light" },
      { photo: "car_1", category: "car" },
      { photo: "building_1", category: "building" },
      { photo: "bus_1", category: "bus" },
      { photo: "traffic_light_2", category: "traffic_light" },
      { photo: "tree_1", category: "tree" },
      { photo: "traffic_light_3", category: "traffic_light" },
      { photo: "bicycle_1", category: "bicycle" },
      { photo: "crosswalk_1", category: "crosswalk" },
    ],
  },
  {
    id: "preset-bicycles",
    target: "bicycle",
    label: "bicycles",
    tiles: [
      { photo: "car_2", category: "car" },
      { photo: "bicycle_1", category: "bicycle" },
      { photo: "tree_2", category: "tree" },
      { photo: "bicycle_2", category: "bicycle" },
      { photo: "bus_2", category: "bus" },
      { photo: "traffic_light_1", category: "traffic_light" },
      { photo: "crosswalk_2", category: "crosswalk" },
      { photo: "bicycle_3", category: "bicycle" },
      { photo: "building_2", category: "building" },
    ],
  },
  {
    id: "preset-buses",
    target: "bus",
    label: "buses",
    tiles: [
      { photo: "bus_1", category: "bus" },
      { photo: "tree_1", category: "tree" },
      { photo: "car_3", category: "car" },
      { photo: "traffic_light_2", category: "traffic_light" },
      { photo: "bus_2", category: "bus" },
      { photo: "bicycle_2", category: "bicycle" },
      { photo: "building_1", category: "building" },
      { photo: "bus_3", category: "bus" },
      { photo: "bus_4", category: "bus" },
    ],
  },
  {
    id: "preset-cars",
    target: "car",
    label: "cars",
    tiles: [
      { photo: "tree_2", category: "tree" },
      { photo: "car_1", category: "car" },
      { photo: "bus_3", category: "bus" },
      { photo: "crosswalk_3", category: "crosswalk" },
      { photo: "traffic_light_3", category: "traffic_light" },
      { photo: "car_2", category: "car" },
      { photo: "car_3", category: "car" },
      { photo: "building_2", category: "building" },
      { photo: "bicycle_3", category: "bicycle" },
    ],
  },
  {
    id: "preset-crosswalks",
    target: "crosswalk",
    label: "crosswalks",
    tiles: [
      { photo: "crosswalk_1", category: "crosswalk" },
      { photo: "bicycle_1", category: "bicycle" },
      { photo: "car_1", category: "car" },
      { photo: "building_1", category: "building" },
      { photo: "crosswalk_2", category: "crosswalk" },
      { photo: "bus_4", category: "bus" },
      { photo: "tree_1", category: "tree" },
      { photo: "traffic_light_1", category: "traffic_light" },
      { photo: "crosswalk_3", category: "crosswalk" },
    ],
  },
];

const TILE_IMAGES: Record<TilePhotoId, ImageSourcePropType> = {
  traffic_light_1: require("../../assets/captcha/traffic_light_1.jpg"),
  traffic_light_2: require("../../assets/captcha/traffic_light_2.jpg"),
  traffic_light_3: require("../../assets/captcha/traffic_light_3.jpg"),
  bicycle_1: require("../../assets/captcha/bicycle_1.jpg"),
  bicycle_2: require("../../assets/captcha/bicycle_2.jpg"),
  bicycle_3: require("../../assets/captcha/bicycle_3.jpg"),
  bus_1: require("../../assets/captcha/bus_1.jpg"),
  bus_2: require("../../assets/captcha/bus_2.jpg"),
  bus_3: require("../../assets/captcha/bus_3.jpg"),
  bus_4: require("../../assets/captcha/bus_4.jpg"),
  car_1: require("../../assets/captcha/car_1.jpg"),
  car_2: require("../../assets/captcha/car_2.jpg"),
  car_3: require("../../assets/captcha/car_3.jpg"),
  crosswalk_1: require("../../assets/captcha/crosswalk_1.jpg"),
  crosswalk_2: require("../../assets/captcha/crosswalk_2.jpg"),
  crosswalk_3: require("../../assets/captcha/crosswalk_3.jpg"),
  tree_1: require("../../assets/captcha/tree_1.jpg"),
  tree_2: require("../../assets/captcha/tree_2.jpg"),
  building_1: require("../../assets/captcha/building_1.jpg"),
  building_2: require("../../assets/captcha/building_2.jpg"),
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
      .map((tile, idx) => (tile.category === challenge.target ? idx : -1))
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
                    aspectRatio: 1,
                    borderRadius: 8,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? themeColors.accent : themeColors.borderSubtle,
                    backgroundColor: themeColors.bgInput,
                    overflow: "hidden",
                    marginBottom: 4,
                  }}
                >
                  <Image
                    source={TILE_IMAGES[tile.photo]}
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
