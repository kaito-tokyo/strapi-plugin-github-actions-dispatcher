import type { Core } from '@strapi/strapi';

interface EventConfig {
  uid: string;
  eventType: string;
  actions: string[];
}

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  const eventConfigs = strapi.config.get<EventConfig[]>(
    'plugin::github-actions-dispatcher.eventConfigs',
    []
  );
  const dispatchService = strapi.service('plugin::github-actions-dispatcher.dispatch');

  strapi.documents.use(async (context, next) => {
    const foundEventConfig = eventConfigs.find(
      (config) => config.uid === context.uid && config.actions.includes(context.action)
    );
    if (foundEventConfig) {
      try {
        await dispatchService.triggerDispatch(foundEventConfig.eventType, { data: context });
      } catch (error) {
        strapi.log.error(`Error dispatching action for uid ${context.uid}: ${error.message}`);
      }
    }
    const result = await next();
    return result;
  });
};

export default register;
