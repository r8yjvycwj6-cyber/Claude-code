package com.horrorentities.registry;

import com.horrorentities.HorrorEntities;
import com.horrorentities.entity.StalkerEntity;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public final class ModEntities {
	public static final DeferredRegister<EntityType<?>> ENTITIES =
			DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, HorrorEntities.MOD_ID);

	public static final RegistryObject<EntityType<StalkerEntity>> STALKER = ENTITIES.register("stalker",
			() -> EntityType.Builder.of(StalkerEntity::new, MobCategory.MONSTER)
					.sized(0.6F, 2.7F)
					.clientTrackingRange(10)
					.build(HorrorEntities.MOD_ID + ":stalker"));

	private ModEntities() {
	}

	public static void onAttributes(EntityAttributeCreationEvent event) {
		event.put(STALKER.get(), StalkerEntity.createAttributes().build());
	}
}
