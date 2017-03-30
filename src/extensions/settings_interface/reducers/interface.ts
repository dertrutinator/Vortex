import { IReducerSpec } from '../../../types/IExtensionContext';

import * as actions from '../actions/interface';
import update = require('react-addons-update');

/**
 * reducer for changes to interface settings
 */
const settingsReducer: IReducerSpec = {
  reducers: {
    [actions.setLanguage as any]: (state, payload) =>
      update(state, { language: { $set: payload } }),
    [actions.setAdvancedMode as any]: (state, payload) =>
      update(state, { advanced: { $set: payload.advanced } }),
    [actions.setProfilesVisible as any]: (state, payload) =>
      update(state, { profilesVisible: { $set: payload.visible } }),
  },
  defaults: {
    language: 'en-GB',
    advanced: false,
    profilesVisible: false,
  },
};

export default settingsReducer;