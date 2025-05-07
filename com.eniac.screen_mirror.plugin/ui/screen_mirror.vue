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
          <v-text-field width="140px" height="40px" v-model="modelValue.data.interval" variant="solo-filled"
            :label="$t('ScreenMirror.UI.UpdateInterval')" type="number" hide-details outlined
            density="compact"></v-text-field>
        </div>
        <div class="ml-2">
          <v-select width="200px" height="40px" v-model="modelValue.data.screenId" variant="solo-filled"
            :items="displays" item-title="name" item-value="id" :label="$t('ScreenMirror.UI.ScreenId')" hide-details
            outlined density="compact">
          </v-select>
        </div>
      </v-col>
      <v-col cols="12">
        <canvas ref="screenCanvas" style="width:100%; height: 200px; display: block;"></canvas>
      </v-col>
      <v-col cols="12" class="d-flex justify-center">
        <div class="flex-column overflow-auto">
          <v-img :src="modelValue.data._base64" :width="modelValue.style.width" height="60" contain
            style="border: 1px solid #ccc; border-radius: 8px;"></v-img>
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
        const interval = parseInt(val)
        if (interval < 350 && interval != 0) {
          this.modelValue.data.interval = 350;
        }
      },
    },
    "modelValue.data.screenId": {
      handler: function (val) {
        this.drawDisplays();
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
    updateCanvasSize() {
      const canvas = this.$refs.screenCanvas;
      const rect = canvas.getBoundingClientRect();
      const dpi = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpi;
      canvas.height = rect.height * dpi;
    },
    drawDisplays() {
      this.updateCanvasSize();
      const canvas = this.$refs.screenCanvas;
      const ctx = canvas.getContext("2d");

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let minLeft = Math.min(...this.displays.map(display => display.left));
      let minTop = Math.min(...this.displays.map(display => display.top));
      let maxRight = Math.max(...this.displays.map(display => display.right));
      let maxBottom = Math.max(...this.displays.map(display => display.bottom));

      const scaleX = canvas.width / (maxRight - minLeft);
      const scaleY = canvas.height / (maxBottom - minTop);
      const scale = Math.min(scaleX, scaleY);

      ctx.lineWidth = 2;

      ctx.font = "18px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let totalWidth = (maxRight - minLeft) * scale;
      let totalHeight = (maxBottom - minTop) * scale;

      let offsetX = (canvas.width - totalWidth) / 2;
      let offsetY = (canvas.height - totalHeight) / 2;

      function drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
        ctx.lineTo(x + radius, y + height);
        ctx.arcTo(x, y + height, x, y + height - radius, radius);
        ctx.lineTo(x, y + radius);
        ctx.arcTo(x, y, x + radius, y, radius);
        ctx.closePath();
      }

      this.displays.forEach(display => {
        console.log(display);
        const { top, left, width, height, id } = display;

        const scaledTop = (top - minTop) * scale + offsetY;
        const scaledLeft = (left - minLeft) * scale + offsetX;
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;

        drawRoundedRect(ctx, scaledLeft, scaledTop, scaledWidth, scaledHeight, 8);

        ctx.fillStyle = "transparent";
        if (this.$fd.theme === 'dark') {
          ctx.strokeStyle = "#cccccc";
        } else {
          ctx.strokeStyle = "#333333";
        }
        ctx.fill();
        ctx.stroke();

        console.log(this.modelValue.data.screenId, id);

        if (this.modelValue.data.screenId === id && this.modelValue.data.bounds) {
          ctx.strokeStyle = "#d81b43";
          const bounds = this.modelValue.data.bounds;
          const boundsTop = (bounds.y ) * scale + scaledTop;
          const boundsLeft = (bounds.x ) * scale + scaledLeft;
          const boundsWidth = bounds.width * scale;
          const boundsHeight = bounds.height * scale;

          drawRoundedRect(ctx, boundsLeft, boundsTop, boundsWidth, boundsHeight, 8);
          ctx.fill();
          ctx.stroke();
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillText(id, scaledLeft + scaledWidth / 2, scaledTop + scaledHeight / 2);
      });
    },
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
        console.log(screenshotData);
        this.modelValue.data._base64 = screenshotData.base64;
        var display = this.displays[0]
        display.dpiScale = display.dpiScale || 1
        if (this.modelValue.data.screenId.length > 0) {
          display = this.displays.find((display) => display.id === this.modelValue.data.screenId);
        }
        this.modelValue.data.bounds = {
          x: parseInt(screenshotData.bounds.x * display.dpiScale),
          y: parseInt(screenshotData.bounds.y * display.dpiScale),
          width: parseInt(screenshotData.bounds.width * display.dpiScale),
          height: parseInt(screenshotData.bounds.height * display.dpiScale),
        }
        this.drawDisplays();
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
        this.displays = await this.$fd.sendToBackend({ action: "listDisplays" });
        console.log(this.displays);
        this.drawDisplays();
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
