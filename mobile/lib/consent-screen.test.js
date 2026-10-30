import { expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';
import { PRIVACY_POLICY } from '../../shared/privacy-policy';

async function consent() {
  const post = vi.fn(async () => ({})), remember = vi.fn(), replace = vi.fn();
  const view = await nativeRender(new URL('../app/consent.js', import.meta.url), { deps: {
    'react-native': { ...nativeViews, Image: 'Image', useWindowDimensions: () => ({ height: 640 }) },
    'expo-router': { useRouter: () => ({ replace }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20 }) },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '../assets/images/onboarding/privacy-shield.png': 1,
    '../lib/api': { api: { post } },
    '../lib/consent': { CURRENT_PRIVACY_POLICY_VERSION: 1, setAcceptedConsentVersion: remember },
    '../../shared/privacy-policy': { PRIVACY_POLICY },
    '../lib/theme': { fonts: {} },
    '../components/ui': { ErrorNotice: 'Error' },
    '../components/onboarding': { OnboardingBackground: 'Background', OnboardingButton: 'Button', OnboardingCard: 'Card', OnboardingConsentRow: 'Agreement', OnboardingHeader: 'Header', onboardingTheme: { colors: {} } },
  } });
  return { view, post, remember, replace };
}

it('lets the driver read the real policy without accepting it', async () => {
  const h = await consent();
  const reader = h.view.find(n => n.props.accessibilityLabel === 'Read privacy policy');
  expect(reader).toBeDefined();
  reader.props.onPress(); h.view.render();
  for (const section of PRIVACY_POLICY.sections) expect(h.view.text()).toContain(section.body);
  expect(h.view.find(n => n.component === 'Agreement').props.checked).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
});

it('does not remember or navigate after an unconfirmed consent save', async () => {
  const h = await consent();
  h.view.find(n => n.component === 'Agreement').props.onToggle(); h.view.render();
  h.post.mockResolvedValue({ queued: true });
  await h.view.find(n => n.props.label === 'Confirm & Continue').props.onPress(); h.view.render();
  expect(h.remember).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled();
  expect(h.post.mock.calls[0][2]).toEqual({ queueOnFailure: false });
  expect(h.view.find(n => n.component === 'Error')).toBeDefined();
});

it('records confirmed acceptance then opens permissions', async () => {
  const h = await consent();
  h.view.find(n => n.component === 'Agreement').props.onToggle(); h.view.render();
  await h.view.find(n => n.props.label === 'Confirm & Continue').props.onPress();
  expect(h.remember).toHaveBeenCalledWith(PRIVACY_POLICY.version);
  expect(h.replace).toHaveBeenCalledWith('/permissions');
});
