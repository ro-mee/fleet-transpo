import { moderateScale } from '../lib/scaling';
import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useTheme } from "../lib/theme-context";
import { fonts, radius, space } from "../lib/theme";
import { Button, ErrorNotice, styles as ui } from "../components/ui";
import { BrandBar } from "../components/logo";
import { MaterialIcons } from "@expo/vector-icons";
// Since expo-camera might not be installed, we will just use dummy permission check for now or rely on native prompts later.
// Actually expo-image-picker is installed based on package.json, so we can request media library / camera permissions from it.
import * as ImagePicker from "expo-image-picker";

function PermissionCard({ icon, title, description }) {
  const { colors, type } = useTheme();
  return (
    <View style={[styles.cardItem, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}>
      <View style={[styles.iconBox, { backgroundColor: colors.primaryContainer }]}>
        <MaterialIcons name={icon} size={24} color={colors.onPrimaryContainer} />
      </View>
      <View style={styles.cardText}>
        <Text style={[type.titleMd, styles.cardTitle, { color: colors.onSurface }]}>{title}</Text>
        <Text style={[type.bodyMd, ui.bodyText, { color: colors.onSurfaceVariant }]}>{description}</Text>
      </View>
    </View>
  );
}

export default function PermissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type } = useTheme();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const onRequestPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Request Location Permission
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      
      // 2. Request Camera Permission (using expo-image-picker which is in package.json)
      const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();

      if (locStatus !== 'granted') {
        // We log it but won't strictly block routing just to allow demo to proceed if simulator denies it.
        console.warn("Location permission not granted");
      }

      // Navigate to the main app layout
      router.replace("/");
    } catch (e) {
      setError(e.message || "Something went wrong while requesting permissions.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl + 80 },
        ]}
      >
        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: colors.secondaryContainer }]}>
            <MaterialIcons name="important-devices" size={48} color={colors.onSecondaryContainer} />
          </View>
          <Text style={[type.headlineMd, styles.title, { color: colors.onSurface }]}>App Permissions</Text>
          <Text style={[type.bodyMd, styles.subtitle, { color: colors.onSurfaceVariant }]}>
            We need a few permissions to give you the best experience on the road.
          </Text>
        </View>

        <ErrorNotice message={error} />

        <View style={styles.cards}>
          <PermissionCard
            icon="near-me"
            title="Location"
            description="Required to dispatch trips and track your progress while on duty."
          />
          <PermissionCard
            icon="photo-camera"
            title="Camera"
            description="Required for scanning fuel receipts and verifying licenses."
          />
        </View>
      </ScrollView>

      {/* Sticky Bottom Bar */}
      <View style={[styles.stickyFooter, { 
        backgroundColor: colors.surface, 
        borderTopColor: colors.outlineVariant,
        paddingBottom: Math.max(insets.bottom, space.md)
      }]}>
        <Button
          label="Enable Permissions"
          onPress={onRequestPermissions}
          loading={loading}
          style={styles.fullButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { 
    paddingHorizontal: space.xl, 
    paddingTop: space.xl, 
    gap: space.xl, 
    width: "100%", 
    maxWidth: moderateScale(720), 
    alignSelf: "center" 
  },
  header: { alignItems: "center", gap: space.sm, marginTop: space.md },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    paddingHorizontal: space.md,
  },
  cards: { gap: space.md },
  cardItem: {
    flexDirection: "row",
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: space.md,
    alignItems: "center"
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { },
  stickyFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  fullButton: { width: "100%" }
});
