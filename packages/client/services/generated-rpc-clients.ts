import type { AviationServiceClient as AviationServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/aviation/v1/service_client';
import type { ClimateServiceClient as ClimateServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/climate/v1/service_client';
import type { ConflictServiceClient as ConflictServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/conflict/v1/service_client';
import type { ConsumerPricesServiceClient as ConsumerPricesServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/consumer_prices/v1/service_client';
import type { CyberServiceClient as CyberServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/cyber/v1/service_client';
import type { DisplacementServiceClient as DisplacementServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/displacement/v1/service_client';
import type { EconomicServiceClient as EconomicServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/economic/v1/service_client';
import type { ForecastServiceClient as ForecastServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/forecast/v1/service_client';
import type { GivingServiceClient as GivingServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/giving/v1/service_client';
import type { HealthServiceClient as HealthServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/health/v1/service_client';
import type { InfrastructureServiceClient as InfrastructureServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/infrastructure/v1/service_client';
import type { IntelligenceServiceClient as IntelligenceServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/intelligence/v1/service_client';
import type { MaritimeServiceClient as MaritimeServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/maritime/v1/service_client';
import type { MarketServiceClient as MarketServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/market/v1/service_client';
import type { MilitaryServiceClient as MilitaryServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/military/v1/service_client';
import type { NaturalServiceClient as NaturalServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/natural/v1/service_client';
import type { NewsServiceClient as NewsServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/news/v1/service_client';
import type { PositiveEventsServiceClient as PositiveEventsServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/positive_events/v1/service_client';
import type { PredictionServiceClient as PredictionServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/prediction/v1/service_client';
import type { RadiationServiceClient as RadiationServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/radiation/v1/service_client';
import type { ResearchServiceClient as ResearchServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/research/v1/service_client';
import type { ResilienceServiceClient as ResilienceServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/resilience/v1/service_client';
import type { ScorecardServiceClient as ScorecardServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/scorecard/v1/service_client';
import type { SanctionsServiceClient as SanctionsServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/sanctions/v1/service_client';
import type { SafetyServiceClient as SafetyServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/safety/v1/service_client';
import type { ScenarioServiceClient as ScenarioServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/scenario/v1/service_client';
import type { SeismologyServiceClient as SeismologyServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/seismology/v1/service_client';
import type { SupplyChainServiceClient as SupplyChainServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/supply_chain/v1/service_client';
import type { ThermalServiceClient as ThermalServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/thermal/v1/service_client';
import type { TradeServiceClient as TradeServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/trade/v1/service_client';
import type { UnrestServiceClient as UnrestServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/unrest/v1/service_client';
import type { WebcamServiceClient as WebcamServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/webcam/v1/service_client';
import type { WildfireServiceClient as WildfireServiceClientInstance } from '@wm/contracts/generated/client/worldmonitor/wildfire/v1/service_client';
import type { MarketServiceClient as MarketServiceClientCtor } from '@wm/contracts/generated/client/worldmonitor/market/v1/service_client';

/** Derived from generated service client constructors so protoc-gen option drift fails typecheck. */
type RpcClientOptions = NonNullable<ConstructorParameters<typeof MarketServiceClientCtor>[1]>;
type RpcClientConstructor<T extends object> = new (baseURL: string, options?: RpcClientOptions) => T;
type RpcClientConstructorLoader<T extends object> = () => Promise<RpcClientConstructor<T>>;
/** Maps every public member that is not an async method to `never`, so `T extends AsyncMethodsOnly<T>` fails for it. */
type AsyncMethodsOnly<T> = { [K in keyof T]: T[K] extends (...args: never[]) => Promise<unknown> ? T[K] : never };

export function createLazyRpcClientConstructor<T extends object & AsyncMethodsOnly<T>>(loadConstructor: RpcClientConstructorLoader<T>): RpcClientConstructor<T> {
  return function LazyRpcClient(baseURL: string, options?: RpcClientOptions): T {
    let clientPromise: Promise<T> | undefined;
    const getClient = () => {
      if (!clientPromise) {
        clientPromise = loadConstructor()
          .then((ClientCtor) => new ClientCtor(baseURL, options))
          .catch((error) => {
            clientPromise = undefined;
            throw error;
          });
      }
      return clientPromise;
    };

    // Every property read yields an invoker, because the real client is not
    // loaded yet. That is only sound when every public member of T is an async
    // method; a field or getter would read as a function here while its type
    // says string or boolean (#4550). The AsyncMethodsOnly constraint rejects
    // such clients at compile time. At runtime a bare read stays silent, so if
    // the loaded client still drifts from its type, invoking a non-method
    // rejects instead of resolving to the value.
    // `then` and `toJSON` stay undefined so await and JSON.stringify treat the
    // proxy as a plain object instead of calling an invoker.
    return new Proxy({}, {
      get(target, property, receiver) {
        if (property === 'then' || property === 'toJSON') return undefined;
        if (typeof property === 'symbol') return Reflect.get(target, property, receiver);
        return (...args: unknown[]) => getClient().then((client) => {
          const value = (client as Record<PropertyKey, unknown>)[property];
          if (typeof value !== 'function') {
            throw new TypeError(
              `Lazy RPC client: "${String(property)}" is not a method on the loaded client `
              + `(got ${value === null ? 'null' : typeof value}). Only async methods can be `
              + 'read through the lazy proxy; access the loaded instance for fields.',
            );
          }
          return value.apply(client, args);
        });
      },
    }) as T;
  } as unknown as RpcClientConstructor<T>;
}

export const AviationServiceClient = createLazyRpcClientConstructor<AviationServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/aviation/v1/service_client');
  return module.AviationServiceClient;
});

export const ClimateServiceClient = createLazyRpcClientConstructor<ClimateServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/climate/v1/service_client');
  return module.ClimateServiceClient;
});

export const ConflictServiceClient = createLazyRpcClientConstructor<ConflictServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/conflict/v1/service_client');
  return module.ConflictServiceClient;
});

export const ConsumerPricesServiceClient = createLazyRpcClientConstructor<ConsumerPricesServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/consumer_prices/v1/service_client');
  return module.ConsumerPricesServiceClient;
});

export const CyberServiceClient = createLazyRpcClientConstructor<CyberServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/cyber/v1/service_client');
  return module.CyberServiceClient;
});

export const DisplacementServiceClient = createLazyRpcClientConstructor<DisplacementServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/displacement/v1/service_client');
  return module.DisplacementServiceClient;
});

export const EconomicServiceClient = createLazyRpcClientConstructor<EconomicServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/economic/v1/service_client');
  return module.EconomicServiceClient;
});

export const ForecastServiceClient = createLazyRpcClientConstructor<ForecastServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/forecast/v1/service_client');
  return module.ForecastServiceClient;
});

export const GivingServiceClient = createLazyRpcClientConstructor<GivingServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/giving/v1/service_client');
  return module.GivingServiceClient;
});

export const HealthServiceClient = createLazyRpcClientConstructor<HealthServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/health/v1/service_client');
  return module.HealthServiceClient;
});

export const InfrastructureServiceClient = createLazyRpcClientConstructor<InfrastructureServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/infrastructure/v1/service_client');
  return module.InfrastructureServiceClient;
});

export const IntelligenceServiceClient = createLazyRpcClientConstructor<IntelligenceServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/intelligence/v1/service_client');
  return module.IntelligenceServiceClient;
});

export const MaritimeServiceClient = createLazyRpcClientConstructor<MaritimeServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/maritime/v1/service_client');
  return module.MaritimeServiceClient;
});

export const MarketServiceClient = createLazyRpcClientConstructor<MarketServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/market/v1/service_client');
  return module.MarketServiceClient;
});

export const MilitaryServiceClient = createLazyRpcClientConstructor<MilitaryServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/military/v1/service_client');
  return module.MilitaryServiceClient;
});

export const NaturalServiceClient = createLazyRpcClientConstructor<NaturalServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/natural/v1/service_client');
  return module.NaturalServiceClient;
});

export const NewsServiceClient = createLazyRpcClientConstructor<NewsServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/news/v1/service_client');
  return module.NewsServiceClient;
});

export const PositiveEventsServiceClient = createLazyRpcClientConstructor<PositiveEventsServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/positive_events/v1/service_client');
  return module.PositiveEventsServiceClient;
});

export const PredictionServiceClient = createLazyRpcClientConstructor<PredictionServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/prediction/v1/service_client');
  return module.PredictionServiceClient;
});

export const RadiationServiceClient = createLazyRpcClientConstructor<RadiationServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/radiation/v1/service_client');
  return module.RadiationServiceClient;
});

export const ResearchServiceClient = createLazyRpcClientConstructor<ResearchServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/research/v1/service_client');
  return module.ResearchServiceClient;
});

export const ResilienceServiceClient = createLazyRpcClientConstructor<ResilienceServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/resilience/v1/service_client');
  return module.ResilienceServiceClient;
});

export const ScorecardServiceClient = createLazyRpcClientConstructor<ScorecardServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/scorecard/v1/service_client');
  return module.ScorecardServiceClient;
});

export const SanctionsServiceClient = createLazyRpcClientConstructor<SanctionsServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/sanctions/v1/service_client');
  return module.SanctionsServiceClient;
});

export const SafetyServiceClient = createLazyRpcClientConstructor<SafetyServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/safety/v1/service_client');
  return module.SafetyServiceClient;
});

export const ScenarioServiceClient = createLazyRpcClientConstructor<ScenarioServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/scenario/v1/service_client');
  return module.ScenarioServiceClient;
});

export const SeismologyServiceClient = createLazyRpcClientConstructor<SeismologyServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/seismology/v1/service_client');
  return module.SeismologyServiceClient;
});

export const SupplyChainServiceClient = createLazyRpcClientConstructor<SupplyChainServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/supply_chain/v1/service_client');
  return module.SupplyChainServiceClient;
});

export const ThermalServiceClient = createLazyRpcClientConstructor<ThermalServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/thermal/v1/service_client');
  return module.ThermalServiceClient;
});

export const TradeServiceClient = createLazyRpcClientConstructor<TradeServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/trade/v1/service_client');
  return module.TradeServiceClient;
});

export const UnrestServiceClient = createLazyRpcClientConstructor<UnrestServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/unrest/v1/service_client');
  return module.UnrestServiceClient;
});

export const WebcamServiceClient = createLazyRpcClientConstructor<WebcamServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/webcam/v1/service_client');
  return module.WebcamServiceClient;
});

export const WildfireServiceClient = createLazyRpcClientConstructor<WildfireServiceClientInstance>(async () => {
  const module = await import('@wm/contracts/generated/client/worldmonitor/wildfire/v1/service_client');
  return module.WildfireServiceClient;
});
