/**
 * Thin topic naming and subscription facade for DamHopper OS services.
 *
 * All subscriptions and cleanups are strictly bound to the originating
 * owner identity (profileId + generation). Cleanup never operates on ambient
 * or replaced connections.
 */

import { useEffect, useState } from "react";
import type { WindowOwnerIdentity } from "./window-context.js";
import type { ConnectionRef } from "@/api/ownership.js";

export type OsTopicName =
  | "agent:status"
  | "host:resources"
  | "host:sleep"
  | "ports:list"
  | "git:status"
  | "workflow:context"
  | "fs:watch";

export interface TopicSubscriptionKey {
  topic: OsTopicName;
  profileId: string;
  generation: number;
}

export type TopicListener<T = unknown> = (data: T) => void;

class TopicBroker {
  private listeners = new Map<string, Set<TopicListener<any>>>();
  private lastSnapshots = new Map<string, unknown>();

  private makeKey(topic: OsTopicName, profileId: string, generation: number): string {
    return `${topic}::${profileId}::${generation}`;
  }

  public subscribe<T>(
    topic: OsTopicName,
    owner: Pick<ConnectionRef, "profileId" | "generation">,
    listener: TopicListener<T>,
  ): () => void {
    const key = this.makeKey(topic, owner.profileId, owner.generation);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    // Deliver cached snapshot if already present
    if (this.lastSnapshots.has(key)) {
      try {
        listener(this.lastSnapshots.get(key) as T);
      } catch (err) {
        console.error(`[TopicBroker] Error delivering initial snapshot for ${key}:`, err);
      }
    }

    // Unsubscribe is bound to originating owner generation
    return () => {
      const activeSet = this.listeners.get(key);
      if (activeSet) {
        activeSet.delete(listener);
        if (activeSet.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  public publish<T>(
    topic: OsTopicName,
    owner: Pick<ConnectionRef, "profileId" | "generation">,
    data: T,
  ): void {
    const key = this.makeKey(topic, owner.profileId, owner.generation);
    this.lastSnapshots.set(key, data);
    const set = this.listeners.get(key);
    if (!set) return;

    for (const listener of set) {
      try {
        listener(data);
      } catch (err) {
        console.error(`[TopicBroker] Error in listener for ${key}:`, err);
      }
    }
  }

  public getSnapshot<T>(
    topic: OsTopicName,
    owner: Pick<ConnectionRef, "profileId" | "generation">,
  ): T | null {
    const key = this.makeKey(topic, owner.profileId, owner.generation);
    return (this.lastSnapshots.get(key) as T) ?? null;
  }

  public clear(): void {
    this.listeners.clear();
    this.lastSnapshots.clear();
  }

  public listenerCount(
    topic: OsTopicName,
    owner: Pick<ConnectionRef, "profileId" | "generation">,
  ): number {
    const key = this.makeKey(topic, owner.profileId, owner.generation);
    return this.listeners.get(key)?.size ?? 0;
  }
}

export const globalTopicBroker = new TopicBroker();

export function subscribeTopic<T>(
  topic: OsTopicName,
  owner: Pick<ConnectionRef, "profileId" | "generation">,
  listener: TopicListener<T>,
): () => void {
  return globalTopicBroker.subscribe(topic, owner, listener);
}

export function publishTopic<T>(
  topic: OsTopicName,
  owner: Pick<ConnectionRef, "profileId" | "generation">,
  data: T,
): void {
  globalTopicBroker.publish(topic, owner, data);
}

export interface UseTopicResult<T> {
  data: T | null;
  status: "connected" | "disconnected" | "stale";
}

export function useTopic<T>(
  topic: OsTopicName,
  owner?: WindowOwnerIdentity | null,
): UseTopicResult<T> {
  const [data, setData] = useState<T | null>(() =>
    owner ? globalTopicBroker.getSnapshot<T>(topic, owner) : null,
  );

  useEffect(() => {
    if (!owner) {
      setData(null);
      return;
    }

    // Capture exact owner identity for lifecycle
    const capturedProfile = owner.profileId;
    const capturedGeneration = owner.generation;

    const unsubscribe = globalTopicBroker.subscribe<T>(
      topic,
      { profileId: capturedProfile, generation: capturedGeneration },
      (incoming) => {
        setData(incoming);
      },
    );

    return () => {
      // Unsubscribe through captured owner
      unsubscribe();
    };
  }, [topic, owner?.profileId, owner?.generation]);

  if (!owner) {
    return { data: null, status: "disconnected" };
  }
  if (!owner.isConnected) {
    return { data, status: "disconnected" };
  }

  return { data, status: "connected" };
}
