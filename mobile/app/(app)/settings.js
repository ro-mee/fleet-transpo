import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
  Modal,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { useSettings } from "../../lib/settings-context";
import ClayScreenHeader from "../../components/ClayScreenHeader";
import { clayMaterials } from "../../lib/clay";
import { moderateScale } from "../../lib/scaling";
import { fonts } from "../../lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, preference, setColorScheme, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 768;

  const { settings, updateSetting } = useSettings();

  const [textSizeModalVisible, setTextSizeModalVisible] = useState(false);
  const [tempTextSize, setTempTextSize] = useState(settings.textSize || 'medium');

  const openTextSizeModal = () => {
    setTempTextSize(settings.textSize || 'medium');
    setTextSizeModalVisible(true);
  };

  const confirmTextSize = () => {
    updateSetting('textSize', tempTextSize);
    setTextSizeModalVisible(false);
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  // Clay card frame shared by every section below. Rows carry their own
  // padding; the card only supplies the raised surface + curve.
  const sectionCard = [
    styles.sectionCard,
    mats.compactShade,
    { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Settings" onBack={goBack} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          wide && { alignSelf: "center", width: "100%", maxWidth: moderateScale(640) },
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* DISPLAY SECTION */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>DISPLAY</Text>
        <View style={sectionCard}>

          <View style={[styles.themeBlock, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "40" }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, mats.clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="moon" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Theme</Text>
            </View>
            <View style={styles.segment}>
              {[
                { key: 'system', label: 'System' },
                { key: 'light', label: 'Light' },
                { key: 'dark', label: 'Dark' },
              ].map((opt) => {
                const active = preference === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setColorScheme(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.segmentOption,
                      active && mats.clayPill,
                      active && {
                        backgroundColor: colors.primary,
                        shadowColor: colors.shadow,
                        shadowOffset: { width: 0, height: 3 },
                        shadowOpacity: 0.14,
                        shadowRadius: 4,
                        elevation: 2,
                      },
                      !active && pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[type.labelLg, { color: active ? colors.onPrimary : colors.onSurfaceVariant }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable onPress={openTextSizeModal} style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "40" }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, mats.clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="text" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Text Size</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[type.bodyMd, { color: colors.onSurfaceVariant }]}>
                {(settings.textSize || 'medium').charAt(0).toUpperCase() + (settings.textSize || 'medium').slice(1)}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
            </View>
          </Pressable>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, mats.clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="contrast" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>High Contrast Mode</Text>
            </View>
            <Switch
              value={settings.highContrast}
              onValueChange={(val) => updateSetting('highContrast', val)}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>
        </View>

      </ScrollView>

      <Modal
        visible={textSizeModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setTextSizeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
            <Text style={[type.titleLg, { color: colors.onSurface, marginBottom: 16 }]}>Select Text Size</Text>
            {['small', 'medium', 'large'].map((size) => (
              <Pressable
                key={size}
                style={[
                  styles.modalOption,
                  tempTextSize === size && { backgroundColor: colors.surfaceContainerHigh }
                ]}
                onPress={() => setTempTextSize(size)}
              >
                <Text style={[type.bodyMd, { color: colors.onSurface }]}>
                  {size.charAt(0).toUpperCase() + size.slice(1)}
                </Text>
                {tempTextSize === size && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </Pressable>
            ))}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setTextSizeModalVisible(false)} style={[styles.modalBtn, mats.clayCta, { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow }]}>
                <Text style={[type.labelLg, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmTextSize} style={[styles.modalBtn, mats.clayCta, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}>
                <Text style={[type.labelLg, { color: colors.onPrimary }]}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, gap: 14 },
  sectionLabel: {
    marginLeft: 8,
    marginBottom: -8,
    fontFamily: fonts.dataSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionCard: {
    borderRadius: 24,
    paddingVertical: 4,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: moderateScale(9),
    paddingHorizontal: 12,
    minHeight: moderateScale(56),
  },
  themeBlock: {
    paddingVertical: moderateScale(9),
    paddingHorizontal: 12,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    flexShrink: 1,
  },
  segment: {
    flexDirection: "row",
    marginTop: 10,
    gap: 6,
  },
  // The active segment overlays mats.clayPill + a shadow/background block
  // via `active && {...}`. Those keys must exist here too (as neutral
  // defaults) so a segment losing selection explicitly resets them — RN
  // doesn't reliably clear a style prop that merely disappears from the
  // style array, which left stale borders/shadows on the deselected pill.
  segmentOption: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 0,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    borderColor: "transparent",
    borderTopWidth: 0,
    borderTopColor: "transparent",
    borderBottomWidth: 0,
    borderBottomColor: "transparent",
    backgroundColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
