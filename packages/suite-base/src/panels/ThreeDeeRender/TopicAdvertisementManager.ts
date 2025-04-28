/**
 * Singleton manager for ROS topic advertisements that uses reference counting
 * to ensure topics remain advertised as long as at least one component needs them.
 */
export class TopicAdvertisementManager {
	private static instance: TopicAdvertisementManager;
	private topicRefCounts: Map<string, number> = new Map();

	private constructor() {}

	public static getInstance(): TopicAdvertisementManager {
		if (!TopicAdvertisementManager.instance) {
			TopicAdvertisementManager.instance = new TopicAdvertisementManager();
		}
		return TopicAdvertisementManager.instance;
	}

	/**
	 * Advertise a topic with reference counting
	 * @returns true if topic was advertised
	 */
	public advertise(
		context: any,
		topic: string,
		type: string,
		options: any
	): boolean {
		const currentCount = this.topicRefCounts.get(topic) || 0;

		this.topicRefCounts.set(topic, currentCount + 1);

		console.debug(`[TopicAdvertisementManager] Increasing ref count for ${topic} to ${currentCount + 1}`);
		context.advertise?.(topic, type, options);
		return true;
	}

	/**
	 * Unadvertise a topic with reference counting
	 * @returns true if topic was actually unadvertised, false if just decremented
	 */
	public unadvertise(
		context: any,
		topic: string
	): boolean {
		const currentCount = this.topicRefCounts.get(topic) || 0;

		if (currentCount <= 0) {
			console.debug(`[TopicAdvertisementManager] Attempted to unadvertise ${topic} but it has no references`);
			return false;
		}

		const newCount = currentCount - 1;
		if (newCount <= 0) {
			// Last reference removed, actually unadvertise
			this.topicRefCounts.delete(topic);
			console.debug(`[TopicAdvertisementManager] Last reference removed, unadvertising ${topic}`);
			context.unadvertise?.(topic);
			return true;
		} else {
			// Decrement count but keep topic advertised
			this.topicRefCounts.set(topic, newCount);
			console.debug(`[TopicAdvertisementManager] Decreased ref count for ${topic} to ${newCount}`);
			return false;
		}
	}

	/**
	 * Get the current reference count for a topic
	 */
	public getRefCount(topic: string): number {
		return this.topicRefCounts.get(topic) || 0;
	}

	/**
	 * Get all currently tracked topics and their reference counts
	 */
	public getAllTopics(): Map<string, number> {
		return new Map(this.topicRefCounts);
	}
}
