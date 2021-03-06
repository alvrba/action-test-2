
import S from 'fluent-json-schema';

// local
import { View, MIN_ACTIONS_SAMPLE_SIZE, MAX_ACTIONS_SAMPLE_SIZE } from '../constants/constants';

export const uuid = S.string().pattern(
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

export const id = S.object().prop('id', uuid).required(['id']);

// schema for getting item analytics with view and requestedSampleSize query parameters
const getOne = {
  params: id,
  querystring: {
    requestedSampleSize: { type: 'number', required: ['requestedSampleSize'], minimum: MIN_ACTIONS_SAMPLE_SIZE, maximum: MAX_ACTIONS_SAMPLE_SIZE },
    view: { type: 'string', required: ['view'], enum: [View.BUILDER_NAME, View.PLAYER_NAME, View.EXPLORER_NAME, View.UNKNOWN_NAME] }
  }
};

// schema for removing all actions of a member
const getOneDeleteActions = {
  params: id,
};

export { getOne, getOneDeleteActions };