package com.horrorentities.registry;

import com.horrorentities.entity.GauntEntity;
import com.horrorentities.entity.HollowEntity;
import com.horrorentities.entity.MimicEntity;
import com.horrorentities.entity.ShadeEntity;
import com.horrorentities.entity.StalkerEntity;

import net.legacyfabric.fabric.api.entity.EntityHelper;
import net.legacyfabric.fabric.api.registry.v2.RegistryHelper;
import net.legacyfabric.fabric.api.registry.v2.RegistryIds;
import net.legacyfabric.fabric.api.util.Identifier;
import net.minecraft.entity.Entity;

public final class ModEntities {
	public static final String STALKER = "stalker";
	public static final String HOLLOW = "hollow";
	public static final String MIMIC = "mimic";
	public static final String GAUNT = "gaunt";
	public static final String SHADE = "shade";

	private ModEntities() {
	}

	public static void register() {
		add(STALKER, StalkerEntity.class, 0x0b0b0f, 0xd9d9d9);
		add(HOLLOW, HollowEntity.class, 0x3a6ea5, 0xffffff);
		add(MIMIC, MimicEntity.class, 0x6b6a4a, 0xb22222);
		add(GAUNT, GauntEntity.class, 0x4d4d4d, 0xe8e0a0);
		add(SHADE, ShadeEntity.class, 0x000000, 0x5b2a86);
	}

	private static void add(String name, Class<? extends Entity> type, int primary, int secondary) {
		Identifier id = ModItems.id(name);
		RegistryHelper.register(RegistryIds.ENTITY_TYPES, id, type);
		EntityHelper.registerSpawnEgg(id, primary, secondary);
	}
}
