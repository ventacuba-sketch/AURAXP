// Debe importarse antes que cualquier código que use `fetch`/`URL` (incluido
// @supabase/supabase-js) — React Native no trae una implementación completa
// de URL, y sin este polyfill supabase-js falla en tiempo de ejecución.
import 'react-native-url-polyfill/auto';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
