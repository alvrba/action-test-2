import geoip from "geoip-lite";

// global
import { FastifyPluginAsync } from "fastify";
import { Item, Member, IdParam, Actor, ItemMembership } from "graasp";

// local
import { CreateActionTask } from './services/action/create-action-task';
import { GetActionsTask } from './services/action/get-actions-task';
import { DeleteActionsTask } from './services/action/delete-actions-task';
import { BaseAction } from './services/action/base-action';
import { ActionService } from './db-service';
import { Action } from "./interfaces/action";
import { paths } from './constants/constants';
import { correctStatusCodes, VIEWS, ACTION_TYPES, METHODS } from './constants/constants';

import {
  getOne
} from './schemas/schemas';
import { BaseAnalytics } from "./services/action/base-analytics";
import { Analytics, AnalyticsQueryParams, ItemIdParam } from "./interfaces/analytics";


export interface GraaspActionsOptions {
  graaspActor: Actor;
}

const actionService = new ActionService();

const plugin: FastifyPluginAsync<GraaspActionsOptions> = async (fastify, options) => {
  const { graaspActor } = options;
  const {
    items: { taskManager: itemTaskManager, dbService: iS },
    members: { taskManager: memberTaskManager, dbService: memberService },
    itemMemberships: { taskManager: itemMembershipsTaskManager, dbService: itemMembershipsService},
    taskRunner: runner,
    log: defaultLogger,
  } = fastify;

  // save action when an item is created
  const createItemTaskName = itemTaskManager.getCreateTaskName();
  runner.setTaskPostHookHandler(createItemTaskName, async (item: Partial<Item>, actor, { log, handler }) => {
    const member = actor as Member;
    const extra = {memberId: actor.id, itemId: item.id};
    const view = VIEWS.BUILDER.name;
    const geo = null;
    const action: Action = new BaseAction(actor.id, item.id, member.type, item.type, ACTION_TYPES.CREATE, view, geo, extra);
    actionService.create(action, handler);
  });

  // save action when an item is deleted
  const deleteItemTaskName = itemTaskManager.getDeleteTaskName();
  runner.setTaskPostHookHandler(deleteItemTaskName, async (item: Partial<Item>, actor, { log, handler }) => {
    const member = actor as Member;
    const extra = {memberId: actor.id, itemId: item.id};
    const view = VIEWS.BUILDER.name;
    const geo = null;
    const action: Action = new BaseAction(actor.id, null, member.type, item.type, ACTION_TYPES.DELETE, view, geo, extra);
    actionService.create(action, handler);
  });

  // get all the actions matching the given `id`
  fastify.get<{ Params: ItemIdParam, Querystring: AnalyticsQueryParams }>(
    '/item/:itemId/analytics',
    { schema: getOne },
    async ({ member, params: { itemId }, query: { requestedSampleSize, view }, log }, reply) => {

      // get actions aplying the parameters (view and requestedSampleSize)
      const t1 = new GetActionsTask(member, itemId, requestedSampleSize, view, actionService);
      await runner.runSingle(t1);
      const actions = t1.result;
      console.log(actions)

      // get item
      const t2 = itemTaskManager.createGetTaskSequence(member, itemId);
      const itemResponse = await runner.runSingleSequence(t2);
      const item = itemResponse as Item;
      console.log(item)

      // get memberships of the item
      const t3 = itemMembershipsTaskManager.createGetOfItemTaskSequence(member, itemId);
      const membershipsResponse = await runner.runSingleSequence(t3);
      const memberships = membershipsResponse as ItemMembership[];
      console.log(memberships)

      // get members of the item
      const tasks = memberships.map((membership) => memberTaskManager.createGetTask(member, membership.memberId));
      const membersResponse = await runner.runMultiple(tasks, log);
      const members = membersResponse as Member[];
      console.log(members)

      const numActionsRetrieved = actions.length;
      const metadata = {
        numActionsRetrieved: numActionsRetrieved,
        requestedSampleSize: parseInt(requestedSampleSize)
      }

      // generate responseData with actions, members, item, and metadata
      const responseData: Analytics = new BaseAnalytics(actions, members, item, metadata);
      
      reply
      .send( responseData )
    },
  );
  
  // delete all the actions matching the given `memberId`
  fastify.delete<{ Params: IdParam }>(
    '/members/:id/delete-actions',
    { schema: getOne },
    async ({ member, params: { id }, log,  }, reply) => {
      const task = new DeleteActionsTask(member, id, actionService);
      await runner.runSingle(task);

      reply
      .send( task.result )      
    },
  );

};


// save action (except create and delete) for the itemId with its actionType and view
const createActionTask = async function (member: Member, itemId: string, actionType: string, view: string, geo, runner, itemTaskManager) {
  // get item
  const t1 = itemTaskManager.createGetTaskSequence(member, itemId);
  const item = await runner.runSingleSequence(t1);
  // save action
  const extra = {memberId: member.id, itemId: item.id};
  let action: Action = new BaseAction(member.id, item.id, member.type, item.type, actionType, view, geo, extra);
  const t2 = new CreateActionTask(member, action, actionService);
  await runner.runSingle(t2);
};

// function called each time there is a request in the items in graasp (onResponse hook in graasp)
// identify and check the correct endpoint of the request
export const createAction = async function (request, reply, runner, itemTaskManager) {
  // check that the request is ok
  if (correctStatusCodes.includes(reply.statusCode)) {
    const url: string = request.url;
    const method: string = request.method;
    const member: Member = request.member;
    const paramItemId: string = request.params.id;
    const queryItemsId: string[] = request.query.id;
    const geo = geoip.lookup(request.ip);

    var view = null;
    const {hostname} = request;
    switch(hostname) {
      case VIEWS.BUILDER.hostname:
        view = VIEWS.BUILDER.name;
        break;
      case hostname == VIEWS.PLAYER.hostname:
        view = VIEWS.PLAYER.name;
        break;
      case hostname == VIEWS.EXPLORER.hostname:
        view = VIEWS.EXPLORER.name;
        break;
      default:
        view = VIEWS.UNKNOWN.name;
        break;
    }

    // identify the endpoint with method and url
    // call createActionTask or createActionTaskMultipleItems to save the corresponding action
    switch(method) {
      case METHODS.GET:
        switch(true) {
          case paths.downloadItem.test(url):
            createActionTask(member, paramItemId, ACTION_TYPES.DOWNLOAD, view, geo, runner, itemTaskManager);
            break;
          case paths.childrenItem.test(url):
            createActionTask(member, paramItemId, ACTION_TYPES.GET_CHILDREN, view, geo, runner, itemTaskManager);
            break;
          case paths.baseItem.test(url):
            createActionTask(member, paramItemId, ACTION_TYPES.GET, view, geo, runner, itemTaskManager);
            break;
        }
        break;
      case METHODS.POST:
        switch(true) {
          case paths.copyItem.test(url):
            createActionTask(member, paramItemId, ACTION_TYPES.COPY, view, geo, runner, itemTaskManager);
            break;
          case paths.moveItem.test(url):
            createActionTask(member, paramItemId, ACTION_TYPES.MOVE, view, geo, runner, itemTaskManager);
            break;
        }
        break;
      case METHODS.PATCH:
        switch(true) {
          case paths.baseItem.test(url):
            createActionTask(member, paramItemId, ACTION_TYPES.UPDATE, view, geo, runner, itemTaskManager);
            break;
          case paths.multipleItems.test(url):
            queryItemsId.map(async (itemId) => await createActionTask(member, itemId, ACTION_TYPES.UPDATE, view, geo, runner, itemTaskManager));
            break;
        }
        break;
    }
  }
};



export default plugin;