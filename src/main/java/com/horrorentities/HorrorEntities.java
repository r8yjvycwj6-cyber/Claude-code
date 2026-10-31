package com.horrorentities;

import com.horrorentities.director.DreadDirector;
import com.horrorentities.registry.ModEntities;
import com.horrorentities.registry.ModItems;
import com.horrorentities.registry.ModRecipes;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import net.fabricmc.api.ModInitializer;
import net.legacyfabric.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.command.CommandRegistry;

public class HorrorEntities implements ModInitializer {
	public static final String MOD_ID = "horrorentities";
	public static final Logger LOGGER = LogManager.getLogger(MOD_ID);

	@Override
	public void onInitialize() {
		HorrorConfig.load();
		ModItems.register();
		ModEntities.register();
		ModRecipes.register();
		DreadDirector.register();
		ServerLifecycleEvents.SERVER_STARTING.register(server ->
				((CommandRegistry) server.getCommandManager()).registerCommand(new HorrorCommand()));
		LOGGER.info("Horror Entities loaded. Do not look behind you.");
	}
}
