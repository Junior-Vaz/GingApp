<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_CTA_LABEL, imageSrc } from '@/utils/sponsors'

/**
 * Pré-visualização do slide "Patrocinado" do carrossel da Home do app (contrato §6), na largura de um celular (375 px).
 * Mesmas medidas do banner do app: 251 px de altura, raio 8, conteúdo com 24/32 px de respiro, título 24 px,
 * texto 12 px (máx. 300 px), selo "Patrocinado" sempre visível. Os controles são só desenho (não clicáveis).
 */
const props = defineProps<{
  title: string
  text: string
  ctaLabel: string
  imageRef: string
  logoRef: string
  sponsorName: string
}>()

const image = computed(() => imageSrc(props.imageRef))
const logo = computed(() => imageSrc(props.logoRef))
const shownTitle = computed(() => props.title.trim() || 'Título da campanha')
const shownText = computed(() => props.text.trim() || 'Texto curto que explica a oferta ao aluno.')
const shownCta = computed(() => props.ctaLabel.trim() || DEFAULT_CTA_LABEL)
const shownSponsor = computed(() => props.sponsorName.trim() || 'Patrocinador')
</script>

<template>
  <figure class="m-0" data-testid="slide-preview">
    <figcaption class="mb-2 text-xs font-medium text-slate-700">Pré-visualização no app (375 px)</figcaption>
    <div class="overflow-x-auto">
      <div
        class="sp-slide"
        role="group"
        aria-label="Pré-visualização do slide patrocinado"
        :class="{ 'sp-slide--plain': !image }"
      >
        <img v-if="image" :src="image" alt="" class="sp-bg" data-testid="preview-image" />
        <div class="sp-shade" aria-hidden="true"></div>
        <div class="sp-content">
          <div class="sp-top">
            <span class="sp-chip" data-testid="preview-sponsor">
              <img v-if="logo" :src="logo" alt="" class="sp-logo" data-testid="preview-logo" />
              <span class="sp-chip-name">{{ shownSponsor }}</span>
            </span>
            <span class="sp-badge" data-testid="preview-badge">Patrocinado</span>
          </div>
          <h3 class="sp-title" data-testid="preview-title">{{ shownTitle }}</h3>
          <p class="sp-text" data-testid="preview-text">{{ shownText }}</p>
          <div class="sp-actions">
            <span class="sp-cta" data-testid="preview-cta">{{ shownCta }} <span aria-hidden="true">↗</span></span>
            <span class="sp-why">Por que vejo isso?</span>
          </div>
        </div>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.sp-slide {
  position: relative;
  width: 375px;
  height: 251px;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
  color: #fff;
  background: #0f2a1d;
  font-family: inherit;
}
.sp-slide--plain {
  background: linear-gradient(120deg, #0f2a1d, #1e4a33 70%, #2c5d3a);
}
.sp-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 58%;
}
.sp-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgb(8 28 18 / 0.92), rgb(8 28 18 / 0.7) 60%, rgb(8 28 18 / 0.45));
}
.sp-content {
  position: relative;
  z-index: 1;
  padding: 24px 32px 30px;
  max-width: 510px;
}
.sp-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sp-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 170px;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: #fff;
  color: #14301f;
  font-size: 11px;
  font-weight: 700;
}
.sp-logo {
  height: 18px;
  width: auto;
  max-width: 48px;
  object-fit: contain;
}
.sp-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  background: #facc15;
  color: #1f1500;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}
.sp-title {
  margin: 10px 0 8px;
  font-size: 24px;
  font-weight: 750;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.sp-text {
  max-width: 300px;
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.92;
  overflow-wrap: anywhere;
}
.sp-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
.sp-cta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  background: #facc15;
  color: #1f1500;
  font-size: 12px;
  font-weight: 700;
}
.sp-why {
  font-size: 10px;
  text-decoration: underline;
  opacity: 0.85;
}
</style>
