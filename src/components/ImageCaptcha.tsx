import React, { useEffect, useState } from "react";
import { Image, ImageSourcePropType, Text, TouchableOpacity, View } from "react-native";

export type TileCategory =
  | "traffic_light"
  | "bicycle"
  | "bus"
  | "car"
  | "crosswalk"
  | "hydrant"
  | "bridge"
  | "motorcycle"
  | "tree"
  | "building";

interface CaptchaTile {
  photo: keyof typeof TILE_IMAGES;
  category: TileCategory;
}

interface ImageChallenge {
  target: TileCategory;
  label: string;
  tiles: CaptchaTile[];
}

const TILE_IMAGES = {
  traffic_light_1: require("../../assets/captcha/traffic_light_1.jpg"),
  traffic_light_2: require("../../assets/captcha/traffic_light_2.jpg"),
  traffic_light_3: require("../../assets/captcha/traffic_light_3.jpg"),
  traffic_light_4: require("../../assets/captcha/traffic_light_4.jpg"),
  bicycle_1: require("../../assets/captcha/bicycle_1.jpg"),
  bicycle_2: require("../../assets/captcha/bicycle_2.jpg"),
  bicycle_3: require("../../assets/captcha/bicycle_3.jpg"),
  bicycle_4: require("../../assets/captcha/bicycle_4.jpg"),
  bus_1: require("../../assets/captcha/bus_1.jpg"),
  bus_2: require("../../assets/captcha/bus_2.jpg"),
  bus_3: require("../../assets/captcha/bus_3.jpg"),
  bus_4: require("../../assets/captcha/bus_4.jpg"),
  car_1: require("../../assets/captcha/car_1.jpg"),
  car_2: require("../../assets/captcha/car_2.jpg"),
  car_3: require("../../assets/captcha/car_3.jpg"),
  car_4: require("../../assets/captcha/car_4.jpg"),
  crosswalk_1: require("../../assets/captcha/crosswalk_1.jpg"),
  crosswalk_2: require("../../assets/captcha/crosswalk_2.jpg"),
  crosswalk_3: require("../../assets/captcha/crosswalk_3.jpg"),
  crosswalk_4: require("../../assets/captcha/crosswalk_4.jpg"),
  hydrant_1: require("../../assets/captcha/hydrant_1.jpg"),
  hydrant_2: require("../../assets/captcha/hydrant_2.jpg"),
  hydrant_3: require("../../assets/captcha/hydrant_3.jpg"),
  hydrant_4: require("../../assets/captcha/hydrant_4.jpg"),
  bridge_1: require("../../assets/captcha/bridge_1.jpg"),
  bridge_2: require("../../assets/captcha/bridge_2.jpg"),
  bridge_3: require("../../assets/captcha/bridge_3.jpg"),
  bridge_4: require("../../assets/captcha/bridge_4.jpg"),
  motorcycle_1: require("../../assets/captcha/motorcycle_1.jpg"),
  motorcycle_2: require("../../assets/captcha/motorcycle_2.jpg"),
  motorcycle_3: require("../../assets/captcha/motorcycle_3.jpg"),
  motorcycle_4: require("../../assets/captcha/motorcycle_4.jpg"),
  tree_1: require("../../assets/captcha/tree_1.jpg"),
  tree_2: require("../../assets/captcha/tree_2.jpg"),
  tree_3: require("../../assets/captcha/tree_3.jpg"),
  tree_4: require("../../assets/captcha/tree_4.jpg"),
  building_1: require("../../assets/captcha/building_1.jpg"),
  building_2: require("../../assets/captcha/building_2.jpg"),
  building_3: require("../../assets/captcha/building_3.jpg"),
  building_4: require("../../assets/captcha/building_4.jpg"),
} satisfies Record<string, ImageSourcePropType>;

type PhotoKey = keyof typeof TILE_IMAGES;

const CATEGORY_CATALOG: Record<TileCategory, { label: string; photos: PhotoKey[] }> = {
  traffic_light: {
    label: "traffic lights",
    photos: ["traffic_light_1", "traffic_light_2", "traffic_light_3", "traffic_light_4"],
  },
  bicycle: {
    label: "bicycles",
    photos: ["bicycle_1", "bicycle_2", "bicycle_3", "bicycle_4"],
  },
  bus: {
    label: "buses",
    photos: ["bus_1", "bus_2", "bus_3", "bus_4"],
  },
  car: {
    label: "cars",
    photos: ["car_1", "car_2", "car_3", "car_4"],
  },
  crosswalk: {
    label: "crosswalks",
    photos: ["crosswalk_1", "crosswalk_2", "crosswalk_3", "crosswalk_4"],
  },
  hydrant: {
    label: "fire hydrants",
    photos: ["hydrant_1", "hydrant_2", "hydrant_3", "hydrant_4"],
  },
  bridge: {
    label: "bridges",
    photos: ["bridge_1", "bridge_2", "bridge_3", "bridge_4"],
  },
  motorcycle: {
    label: "motorcycles",
    photos: ["motorcycle_1", "motorcycle_2", "motorcycle_3", "motorcycle_4"],
  },
  tree: {
    label: "trees",
    photos: ["tree_1", "tree_2", "tree_3", "tree_4"],
  },
  building: {
    label: "buildings",
    photos: ["building_1", "building_2", "building_3", "building_4"],
  },
};

const TARGET_CATEGORIES: TileCategory[] = [
  "traffic_light",
  "bicycle",
  "bus",
  "car",
  "crosswalk",
  "hydrant",
  "bridge",
  "motorcycle",
];

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateDynamicChallenge(excludeTarget?: TileCategory): ImageChallenge {
  const candidates = excludeTarget
    ? TARGET_CATEGORIES.filter((c) => c !== excludeTarget)
    : TARGET_CATEGORIES;
  const target = candidates[Math.floor(Math.random() * candidates.length)];

  const targetCount = Math.random() < 0.5 ? 3 : 4;
  const targetPhotos = shuffleArray(CATEGORY_CATALOG[target].photos)
    .slice(0, targetCount)
    .map((photo) => ({ photo, category: target }));

  const distractorPool: CaptchaTile[] = [];
  for (const [cat, info] of Object.entries(CATEGORY_CATALOG) as [TileCategory, { label: string; photos: PhotoKey[] }][]) {
    if (cat === target) continue;
    for (const photo of info.photos) {
      distractorPool.push({ photo, category: cat });
    }
  }

  const distractors = shuffleArray(distractorPool).slice(0, 9 - targetCount);
  const tiles = shuffleArray([...targetPhotos, ...distractors]);

  return {
    target,
    label: CATEGORY_CATALOG[target].label,
    tiles,
  };
}

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

export const IMAGE_CAPTCHA_POOL_LENGTH = TARGET_CATEGORIES.length;

export function ImageCaptcha({
  verified,
  onVerifyChange,
  challengeIndex,
  onCycleChallenge,
  themeColors,
}: ImageCaptchaProps) {
  const [challenge, setChallenge] = useState<ImageChallenge>(() => generateDynamicChallenge());
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setChallenge((prev) => generateDynamicChallenge(prev.target));
    setSelectedIndices([]);
    setErrorMsg(null);
  }, [challengeIndex]);

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
      setErrorMsg("Selection did not match. Try the new challenge.");
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
            : `SELECT ALL: ${challenge.label.toUpperCase()}`}
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
                  key={`${challenge.target}-${tile.photo}-${idx}`}
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
