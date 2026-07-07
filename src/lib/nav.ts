import { router } from 'expo-router';

/**
 * Go back if there's history, otherwise navigate to a fallback route.
 * Prevents the "GO_BACK was not handled" error when a screen is opened as the
 * first route (deep link, modal launched directly, cold start on that path).
 */
export function goBack(fallback: Parameters<typeof router.replace>[0] = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
