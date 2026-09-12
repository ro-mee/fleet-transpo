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
import { ClayCard, ClayButton, ClayTile } from "../../components/clay";
import { pillEdges } from "../../lib/clay";
import { moderateScale } from "../../lib/scaling";
import { fonts } from "../../lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, preference, setColorScheme, type, scheme, isDark } = useTheme();
  const isDarkTheme = isDark ?? (scheme === "dark");
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
        <ClayCard variant="standard" style={styles.sectionCard}>

          <View style={[styles.themeBlock, { borderBottomWidth: 1, borderBottomColor: isDarkTheme ? colors.outlineVariant + "40" : "transparent" }]}>
            <View style={styles.rowLeft}>
              <ClayTile icon="moon" size="sm" variant="surface" />
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Theme</Text>
            </View>
            <View style={[styles.segment, { backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: isDarkTheme ? 'rgba(255,255,255,0.06)' : colors.outlineVariant + '30' }]}>
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
                    style={[
                      styles.segmentOption,
                      active && {
                        backgroundColor: colors.primary,
                        shadowColor: colors.shadow,
                        shadowOpacity: isDarkTheme ? 0.3 : 0.12,
                        shadowOffset: { width: 0, height: 2 },
                        shadowRadius: 4,
                        elevation: 2,
                      },
                    ]}
                  >
                    <Text style={[type.labelLg, { color: active ? colors.onPrimary : colors.onSurfaceVariant, fontWeight: active ? '600' : '500' }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable onPress={openTextSizeModal} style={[styles.row, { borderBottomWidth: 1, borderBottomColor: isDarkTheme ? colors.outlineVariant + "40" : "transparent" }]}>
            <View style={styles.rowLeft}>
              <ClayTile icon="text" size="sm" variant="surface" />
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
              <ClayTile icon="contrast" size="sm" variant="surface" />
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>High Contrast Mode</Text>
            </View>
            <Switch
              value={settings.highContrast}
              onValueChange={(val) => updateSetting('highContrast', val)}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor={colors.surfaceBright || "#FFFFFF"}
            />
          </View>
        </ClayCard>

      </ScrollView>

      <Modal
        visible={textSizeModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setTextSizeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ClayCard variant="standard" style={styles.modalContent}>
            <Text style={[type.titleLg, { color: colors.onSurface, marginBottom: 16 }]}>Select Text Size</Text>
            {['small', 'medium', 'large'].map((size) => (
              <Pressable
                key={size}
                style={[
                  styles.modalOption,
                  pillEdges(isDarkTheme),
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
              <ClayButton
                label="Cancel"
                variant="tonal"
                onPress={() => setTextSizeModalVisible(false)}
                style={{ flex: 1 }}
              />
              <ClayButton
                label="Confirm"
                variant="primary"
                onPress={confirmTextSize}
                style={{ flex: 1 }}
              />
            </View>
          </ClayCard>
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
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    flexShrink: 1,
  },
  segment: {
    flexDirection: "row",
    marginTop: 10,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderRadius: 10,
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
});
