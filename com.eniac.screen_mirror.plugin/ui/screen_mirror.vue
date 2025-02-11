<template>
  <v-container>
    <v-row>
      <v-col cols="12" class="d-flex justify-center align-center">
        <v-btn @click="getScreenArea" :loading="loading" variant="tonal" height="40px">
          {{ $t('ScreenMirror.UI.GetScreenArea') }}
          <template v-slot:loader>
            <v-progress-circular color="orange" size="30" indeterminate></v-progress-circular>
          </template>
        </v-btn>
        <div class="ml-2">
          <v-text-field width="140px" height="40px" v-model="modelValue.data.interval" variant="solo-filled" :label="$t('ScreenMirror.UI.UpdateInterval')" type="number" hide-details outlined density="compact"></v-text-field>
        </div>
        <div class="ml-2">
          <v-select width="200px" height="40px" v-model="modelValue.data.screenId" variant="solo-filled" :items="displays" item-title="name" item-value="id" :label="$t('ScreenMirror.UI.ScreenId')" hide-details outlined density="compact"></v-select>
        </div>
      </v-col>
      <v-col cols="12" class="d-flex justify-center">
        <div class="flex-column overflow-auto">
          <v-img :src="modelValue.data._base64" :width="modelValue.style.width" height="60" contain style="border: 1px solid #ccc; border-radius: 8px;"></v-img>
          <p class="text-body-1">{{ bounds }}</p>
        </div>
      </v-col>
    </v-row>
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
    return {
      loading: false,
      displays: [],
    };
  },
  watch: {
    "modelValue.data.interval": {
      handler: function (val) {
        if (parseInt(val) < 350) {
          this.modelValue.data.interval = 350;
        }
      },
    },
  },
  computed: {
    bounds() {
      try {
        return `X ${this.modelValue.data.bounds.x}, Y ${this.modelValue.data.bounds.y}, W ${this.modelValue.data.bounds.width}, H ${this.modelValue.data.bounds.height}`;
      } catch (error) {
        return "";
      }
    },
  },
  methods: {
    async getScreenArea() {
      try {
        /* screenshotData
        * {
        *   "base64": "data:image/png;base64,iVBORw0KGgoA...",
        *   "bounds": {
        *     "x": 221,
        *     "y": 279,
        *     "width": 904,
        *     "height": 561
        *   }
        * }
        */
        const screenshotData = await this.$fd.takeScreenshot();
        this.modelValue.data._base64 = screenshotData.base64;
        var display = this.displays[0]
        if (this.modelValue.data.screenId.length > 0) {
          display = this.displays.find((display) => display.id === this.modelValue.data.screenId);
        }
        this.modelValue.data.bounds = {
          x: parseInt(screenshotData.bounds.x * display.dpiScale),
          y: parseInt(screenshotData.bounds.y * display.dpiScale),
          width: parseInt(screenshotData.bounds.width * display.dpiScale),
          height: parseInt(screenshotData.bounds.height * display.dpiScale),
        }
      } catch (error) {
        this.$fd.error(error);
      }
    },
    async getDisplays() {
      try {
        /**
         * {
         *    "id": "\\\\.\\DISPLAY2",
         *    "name": "\\\\.\\DISPLAY2",
         *    "top": 0,
         *    "right": 2560,
         *    "bottom": 1440,
         *    "left": 0,
         *    "dpiScale": 1.25,
         *    "height": 1440,
         *    "width": 2560
         *  }
         */
        this.displays = await this.$fd.sendToBackend({action: "listDisplays"});
        console.log(this.displays);
      } catch (error) {
        this.$fd.error(error);
      }
    }
  },
  mounted() {
    setTimeout(() => {
      this.getDisplays();
    }, 1000);
  }
};
</script>

<style scoped></style>
