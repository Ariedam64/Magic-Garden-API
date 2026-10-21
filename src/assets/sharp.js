// src/assets/sharp.js

import sharp from "sharp";
import { config } from "../config/index.js";

/**
 * sharp, réglé une fois pour tout le processus.
 *
 * Les réglages de libvips sont globaux : les poser ici, dans le module que
 * tous les appelants importent à la place de `sharp`, garantit qu'ils
 * s'appliquent aussi aux processus fils (exports de sprites, animations) sans
 * dépendre de l'ordre des imports.
 *
 * - `concurrency` : threads libvips par pipeline. Par défaut un par cœur ; sur
 *   2 vCPU partagés avec l'API, et pour des pipelines de quelques
 *   millisecondes, un seul suffit — et chaque thread en moins est une arène
 *   malloc de moins (voir config.native).
 * - `cache` : le cache d'opérations ne sert qu'aux pipelines répétés à
 *   l'identique, ce que nous ne faisons pas ; il retient en revanche des
 *   images intermédiaires. On le borne serré.
 */
sharp.concurrency(config.native.sharpConcurrency);
sharp.cache({
  memory: config.native.sharpCacheMemoryMb,
  files: 0,
  items: config.native.sharpCacheItems,
});

export default sharp;
