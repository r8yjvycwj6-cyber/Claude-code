package com.horrorentities.director;

import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;

/** Remembers on which day the Stalker last appeared, so it comes once per night and not again after it is killed. */
public class HauntData extends SavedData {
	private static final String NAME = "horrorentities_haunt";

	private long lastSpawnDay = -1;

	public static HauntData get(ServerLevel level) {
		return level.getDataStorage().computeIfAbsent(new SavedData.Factory<>(HauntData::new, HauntData::load, null), NAME);
	}

	private static HauntData load(CompoundTag tag, HolderLookup.Provider registries) {
		HauntData data = new HauntData();
		data.lastSpawnDay = tag.contains("LastSpawnDay") ? tag.getLong("LastSpawnDay") : -1;
		return data;
	}

	public long lastSpawnDay() {
		return this.lastSpawnDay;
	}

	public void markSpawned(long day) {
		this.lastSpawnDay = day;
		this.setDirty();
	}

	public void reset() {
		this.lastSpawnDay = -1;
		this.setDirty();
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		tag.putLong("LastSpawnDay", this.lastSpawnDay);
		return tag;
	}
}
