import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and correctly wraps it whether the app runs in Expo Go, a native build,
// or the web target.
registerRootComponent(App);
