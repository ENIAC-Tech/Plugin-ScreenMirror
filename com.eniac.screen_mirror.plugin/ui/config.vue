<template>
  <v-container>
    <v-card prepend-icon="mdi-pencil" :title="$t('Config.Title')">
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-text-field
              v-model="modelValue.config.shortcut"
              variant="underlined"
              :label="$t('Config.Shortcut')"
              outlined
              :hint="$t('Config.ShortcutTip')"
              persistent-hint
            >
            </v-text-field>
          </v-col>
          <v-col cols="12">
            <p>{{ $t('Config.SeeShortcut') }}</p>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn variant="text" icon @click="saveConfig">
          <v-icon>mdi-check-circle-outline</v-icon>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script>
export default {
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {};
  },
  methods: {
    saveConfig() {
        this.$fd.setConfig(this.modelValue.config);
        this.$fd.showSnackbarMessage("success", this.$t('Config.SaveSuccess'));
    },
  },
  mounted() {
  },
};
</script>

<style scoped></style>
