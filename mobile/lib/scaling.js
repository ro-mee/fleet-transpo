import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Use iPhone 11 Pro / iPhone X as baseline size
const guidelineBaseWidth = 375;
const guidelineBaseHeight = 812;

// Scales horizontally
const scale = (size) => (width / guidelineBaseWidth) * size;

// Scales vertically
const verticalScale = (size) => (height / guidelineBaseHeight) * size;

// Moderate scale - combines base size with some scaling factor
const moderateScale = (size, factor = 0.5) => size + (scale(size) - size) * factor;

export { scale, verticalScale, moderateScale, width, height };
