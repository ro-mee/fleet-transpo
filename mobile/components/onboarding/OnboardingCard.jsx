import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../lib/theme";
import { onboardingTheme } from "./onboardingTheme";

function mapIconName(name) {
  if (!name) return "information-circle-outline";
  switch (name) {
    case "location":
    case "location-on":
    case "location-pin":
      return "location-sharp";
    case "navigate":
    case "navigation":
    case "compass":
      return "navigate-sharp";
    case "camera":
    case "camera-outline":
      return "camera";
    case "images":
    case "images-outline":
    case "photo-library":
    case "photo":
      return "images";
    case "car":
    case "directions-car":
    case "vehicle":
      return "car-sport";
    case "shield":
    case "security":
      return "shield-checkmark";
    case "time":
    case "update":
    case "clock":
      return "time-outline";
    default:
      return name;
  }
}

function resolveStatusInfo(status) {
  if (!status) return null;
  if (typeof status === "string") {
    const s = status.toLowerCase();
    if (s.includes("approv") || s.includes("grant")) {
      return { label: "Approved", type: "approved" };
    }
    if (s.includes("deni") || s.includes("block")) {
      return { label: status, type: "denied" };
    }
    return { label: status, type: "not_asked" };
  }
  if (typeof status === "object") {
    const label = status.label || "Not asked";
    const tone = status.tone || "neutral";
    if (tone === "success" || label.toLowerCase().includes("approv")) {
      return { label, type: "approved" };
    }
    if (tone === "warning" || tone === "error" || label.toLowerCase().includes("deni")) {
      return { label, type: "denied" };
    }
    return { label, type: "not_asked" };
  }
  return null;
}

export function OnboardingCard({
  icon,
  title,
  description,
  status,
  compact = false,
  onPress,
  showChevron = true,
  style,
}) {
  const { colors } = onboardingTheme;
  const statusInfo = resolveStatusInfo(status);
  const iconName = mapIconName(icon);

  const cardStyle = [
    styles.card,
    compact && styles.cardCompact,
    style,
  ];

  const content = (
    <>
      {/* Icon Tile */}
      <View style={[styles.iconTile, compact && styles.iconTileCompact]}>
        <Ionicons
          name={iconName}
          size={compact ? 19 : 22}
          color={colors.mint}
        />
      </View>

      {/* Middle Text Content */}
      <View style={styles.contentCol}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, compact && styles.titleCompact]}
            numberOfLines={1}
          >
            {title}
          </Text>

          {statusInfo && (
            <View
              style={[
                styles.statusChip,
                statusInfo.type === "approved" && styles.chipApproved,
                statusInfo.type === "denied" && styles.chipDenied,
                statusInfo.type === "not_asked" && styles.chipNotAsked,
              ]}
            >
              {statusInfo.type === "approved" && (
                <Ionicons
                  name="checkmark"
                  size={11}
                  color={colors.chipApprovedText}
                  style={styles.chipIcon}
                />
              )}
              <Text
                style={[
                  styles.chipText,
                  statusInfo.type === "approved" && { color: colors.chipApprovedText },
                  statusInfo.type === "denied" && { color: colors.chipDeniedText },
                  statusInfo.type === "not_asked" && { color: colors.chipNotAskedText },
                ]}
              >
                {statusInfo.label}
              </Text>
            </View>
          )}
        </View>

        <Text style={[styles.description, compact && styles.descriptionCompact]}>
          {description}
        </Text>
      </View>

      {/* Right Chevron */}
      {showChevron && (
        <View style={styles.chevronWrap}>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.chevron}
          />
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          cardStyle,
          pressed && styles.cardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${description}${statusInfo ? `. Status: ${statusInfo.label}` : ""}`}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={cardStyle}
      accessibilityLabel={`${title}. ${description}${statusInfo ? `. Status: ${statusInfo.label}` : ""}`}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: onboardingTheme.colors.surface,
    borderWidth: 1,
    borderColor: onboardingTheme.colors.surfaceBorder,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 5,
    elevation: 3,
  },
  cardCompact: {
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  iconTile: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: onboardingTheme.colors.iconTileBg,
    borderWidth: 1,
    borderColor: onboardingTheme.colors.iconTileBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTileCompact: {
    width: 40,
    height: 40,
    borderRadius: 11,
  },
  contentCol: {
    flex: 1,
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontFamily: fonts.displayBold,
    fontSize: 15,
    lineHeight: 19,
    color: onboardingTheme.colors.textPrimary,
  },
  titleCompact: {
    fontSize: 14,
    lineHeight: 17,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: onboardingTheme.colors.textSecondary,
    marginTop: 2,
  },
  descriptionCompact: {
    fontSize: 11.5,
    lineHeight: 15.5,
    marginTop: 1,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipApproved: {
    backgroundColor: onboardingTheme.colors.chipApprovedBg,
    borderColor: onboardingTheme.colors.chipApprovedBorder,
  },
  chipDenied: {
    backgroundColor: onboardingTheme.colors.chipDeniedBg,
    borderColor: onboardingTheme.colors.chipDeniedBorder,
  },
  chipNotAsked: {
    backgroundColor: onboardingTheme.colors.chipNotAskedBg,
    borderColor: onboardingTheme.colors.chipNotAskedBorder,
  },
  chipIcon: {
    marginRight: 3,
  },
  chipText: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 10.5,
    lineHeight: 13,
  },
  chevronWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
});
