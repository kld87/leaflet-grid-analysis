/*jshint esversion: 6 */

//consts
const GUTTER_RADIUS = 1;
const GRID_ZOOM_LIMIT = 15;

//map vars
var map,
	layers = {
		basemaps: {},
		overlays: {}
	},
	controls = {};

//params and data vars
var params = {
		origin: L.latLng(42.98247, -81.24904),
		originZoom: 15,
		radius: 1000,//via user
		pointNum: 100, //via user
		cellLength: 250, //via user, length in m of grid cell
		markerMax: 1 //for "heatmap" computations
	},
	markers = [],
	grid = [],
	gridLayer, //handled outside "layers" var since we manipulate/add/remove it so much
	welcomeStep;

$(document).ready(function() {
	//construct the underlaying map prior to param processing
	buildMap();

	//show "welcome" modal & init its vars
	step();
	$('#welcome-modal').modal();
	$('#radius-m').val(params.radius);
	$('#point-num').val(params.pointNum);
	$('#cell-len').val(params.cellLength);
});

function buildMap() {
	//create our map and set its basemaps and events
	map = L.map('map').setView(params.origin, params.originZoom); //centre on Lovely London
	addBasemaps();

	//create/add controls
	//scale
	controls.scale = L.control.scale();
	controls.scale.addTo(map);
	//toolbar
	controls.toolbar = createToolbar({position: 'topright'});
	map.addControl(controls.toolbar);
	//layers
	controls.layers = L.control.layers(layers.basemaps, layers.overlays);
	controls.layers.addTo(map);
	//zoombox
	controls.zoombox = L.control.zoomBox({
		modal: true,
		title: 'Hold shift to use natively',
		position: 'topleft'
	});
	map.addControl(controls.zoombox);
	//geocoder
	controls.geocoder = L.Control.geocoder({position: 'topleft'});
	controls.geocoder.addTo(map);

	//final setup
	createMarkerGroup();
	setMapEvents();
}

//called after completing welcome modal to bootstrap things
function initialize() {
	setBasemap();
	setParams();
	createGrid();
	createPoints();
	computeScores();
	handleGridVisibility();

	//unhide close button on the welcome modal so user can abort the "reset" process going forward
	$('#welcome-close').removeClass('d-none');
}

function addBasemaps() {
	layers.basemaps = {
		'CartoDB Voyager': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
			subdomains: 'abcd',
			maxZoom: 19
		}),
		'CartoDB Positron': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
			subdomains: 'abcd',
			maxZoom: 19
		}),
		'OSM':  L.tileLayer( 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
			subdomains: ['a','b','c']
		})
	};
	layers.basemaps['CartoDB Voyager'].addTo(map);
}

//handle user's welcome modal selection for which basemap to use
function setBasemap() {
	var index = $('#basemap-carousel div.active').index(),
		target;
	switch (index) {
		case 0: //voyager
			target = layers.basemaps['CartoDB Voyager'];
			break;
		case 1: //positron
			target = layers.basemaps['CartoDB Positron'];
			break;
		case 2: //OSM
			target = layers.basemaps.OSM;
			break;
	}
	_.forEach(layers.basemaps, function(basemap) {
		if (basemap !== target) {
			map.removeLayer(basemap);
		} else if (!map.hasLayer(basemap)) {
			basemap.addTo(map);
		}
	});
}

//custom toolbar control
function createToolbar(options) {
	var toolbar = L.Control.extend({
		onAdd: function(map) {
			var options = this.options,
				container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom toolbar');
			options.active = options.active || null;

			//stop click/scroll events from propigating to the lower map
			L.DomEvent
				.disableClickPropagation(container)
				.disableScrollPropagation(container);

			//helper function to handle marker add/remove toggles
			function toggle(e, control) {
				$('.toolbar-toggle').addClass('toolbar-toggle-inactive');
				if (options.active !== control) { //toggle on
					$(e.target).removeClass('toolbar-toggle-inactive');
					options.active = control;
				} else { //toggling off
					options.active = null;
				}
			}

			//build contents, register events
			$(container).append( //add marker
				$('<button class="btn btn-success toolbar-toggle toolbar-toggle-inactive" title="Add Marker Mode" type="button"><i class="fas fa-map-marker-alt"></i></button>')
					.on('click', function(e) {
						toggle(e, 'add');
					})
				);
			$(container).append( //remove marker
				$('<button class="btn btn-danger toolbar-toggle toolbar-toggle-inactive" title="Remove Marker Mode" type="button"><i class="fas fa-trash"></i></button>')
					.on('click', function(e) {
						toggle(e, 'remove');
					})
				);
			$(container).append('<div class="toolbar-break"></div>'); //spacer
			$(container).append( //welcome popup
				$('<button class="btn btn-warning toolbar-button" type="button" title="Reset"><i class="fas fa-sync-alt"></i></button>')
					.on('click', function(e) {
						step();
						$('#welcome-modal').modal();
					})
				);
			//about popup
			$(container).append('<button class="btn btn-info toolbar-button" type="button" title="About" data-toggle="modal" data-target="#about-modal"><i class="fas fa-info"></i></button>');

			return container;
		}
	});
	return new toolbar(options);
}

//group our markers to make working with them easier
function createMarkerGroup() {
	var popup = L.popup(),
		markerGroup = L.featureGroup()
			.on('click', function(e) {
				var marker = e.sourceTarget;
				if (controls.toolbar.options.active == 'remove') { //remove mode
					removeMarker(marker);
				} else { //normal click handler, display info popup
					//reverse geocode to get address
					controls.geocoder.options.geocoder.reverse(e.latlng, map.options.crs.scale(map.getMaxZoom()), function(result) { //max zoom to get as precise as possible of a result
						//format popup content
						var content = '<b>Marker #' + marker.options.data.id + '</b><br>';
						content += '<em>' + marker.options.data.nearby + ' nearby, ' + (grid[marker.options.data.x][marker.options.data.y].length-1) + ' other(s) in this quadrant</em><br>';
						content += '<em>Density score: ' + _.round(marker.options.data.score, 2) + '</em><br>';
						if (result && result[0]) {
							//remove comma from address number (OSM sometimes returns 123, some street, ...), then take everything left of the first (remaining) comma for cleanliness
							content += 'Location: ' + result[0].name.replace(/^([0-9]+),/, '$1').split(',')[0] + '<br>';
						}
						content += '<small>Loc: ' + _.round(e.latlng.lat, 4) + ', ' + _.round(e.latlng.lng, 4) + '</small><br>';
						content += '<small>X/Y: ' + marker.options.data.x + ', ' + marker.options.data.y + '</small><br>';

						//display
						popup.setLatLng(e.latlng)
							.setContent(content)
							.openOn(map);
					});
				}
			});
	markerGroup.addTo(map);
	layers.overlays.Markers = markerGroup;
	controls.layers.addOverlay(layers.overlays.Markers, 'Markers');
}

function setMapEvents() {
	//mouse events
	map.on('mousemove', function(e) { //update latlng text overlay
		var coords = _.round(e.latlng.lat, 5) + ', ' + _.round(e.latlng.lng, 5);
		$('#coords').show();
		$('#coords').text(coords);
	}).on('mouseout', function() { //hide latlng text overlay when moving off map
		$('#coords').hide();
	}).on('click', function(e) { //handle marker creation while in add mode
		if (controls.toolbar.options.active == 'add') {
			addMarker(e.latlng);
			computeScores();
		}
	});

	//grid visibility events
	map.on('zoomstart', function(e) { //hide if we're zooming out too far
		if (!gridLayer) return;
		map.removeLayer(gridLayer);
	}).on('zoomend', function() { //show if we're within zoom scope
		handleGridVisibility();
	}).on('baselayerchange', function() { //address z-index issues given we're stacking multiple tile layers
		setTimeout(function() {
			gridLayer.bringToFront();
		}, 1);
	});
}

function setParams() {
	//set params from user inputs (welcome modal)
	params.origin = map.getCenter();
	params.radius = parseInt($('#radius-m').val());
	params.pointNum = parseInt($('#point-num').val());
	params.cellLength = parseInt($('#cell-len').val());

	//display bounding circle
	if (layers.overlays.Radius) {
		map.removeLayer(layers.overlays.Radius);
		controls.layers.removeLayer(layers.overlays.Radius);
	}
	layers.overlays.Radius = L.circle([params.origin.lat, params.origin.lng], params.radius);
	layers.overlays.Radius.addTo(map);
	controls.layers.addOverlay(layers.overlays.Radius, 'Radius');
}

function createPoints() {
	//clear arrays in case we're refreshing
	markers.length = 0;
	grid.length = 0;
	layers.overlays.Markers.getLayers().forEach(function(layer) {
		map.removeLayer(layer);
	});

	//create random markers
	for (i = 0; i < params.pointNum; i++) {
		//seed the random point, working in radians
		var polarAngle = Math.PI*2 * Math.random(),
			distance = params.radius * Math.sqrt(Math.random()); //re: sqrt, see: https://programming.guide/random-point-within-circle.html

		//GeometryUtils (gu) works in degrees, going clockwise from North = 0, so we have to do some conversion
		//see: https://makinacorpus.github.io/Leaflet.GeometryUtil/global.html#destination
		var guAngle = 90 - (polarAngle * (180/Math.PI));
			guAngle = guAngle < 0 ? 360 + guAngle : guAngle;

		//create our marker point
		addMarker(L.GeometryUtil.destination(params.origin, guAngle, distance));
	}
}

//make our custom GridLayer overlay
function createGrid() {
	if (gridLayer) return;
	gridLayer = new L.GridLayer();

	//handle tile size (length m) vs. zoom/scale to be consistent despite zoom
	gridLayer.getTileSize = function() {
		//https://stackoverflow.com/questions/22443350/leaflet-pixel-size-depending-on-zoom-level
		var metresPerPixel = 40075016.686 * Math.abs(Math.cos(params.origin.lat / 180 * Math.PI)) / Math.pow(2, map.getZoom()+8),
			s = params.cellLength / metresPerPixel;
		return L.point(s, s);
	};

	//handle tile creation/styling
	gridLayer.createTile = function(coords) {
		//http://bl.ocks.org/letmaik/e71eae5b3ae9e09f8aeb288c3b95230b
		var size = this.getTileSize(),
			tile = L.DomUtil.create('div', 'leaflet-tile');
		tile.classList.add('grid-tile');

		//show coords if there's enough space
		if (size.x > 100) {
			var nwPoint =  map.unproject(coords.scaleBy(size), coords.z);
			tile.innerHTML = _.round(nwPoint.lat, 4) + ',' + _.round(nwPoint.lng, 4) + '<br>' + coords.x + ',' + coords.y;
		}

		//heatmap styling
		if (params.markerMax && grid[coords.x] && grid[coords.x][coords.y] && grid[coords.x][coords.y].length > 0) {
			//https://stackoverflow.com/questions/12875486/what-is-the-algorithm-to-create-colors-for-a-heatmap
			var h = 240 * (1 - grid[coords.x][coords.y].length / params.markerMax);
			tile.style.backgroundColor = 'hsla(' + h + ', 100%, 50%, 0.25)';
		}

		return tile;
	};
}

//show/hide the grid based on zoomlevel re: efficiency
function handleGridVisibility() {
	if (!gridLayer) return;
	if (map.getZoom() >= GRID_ZOOM_LIMIT && !map.hasLayer(gridLayer)) {
		map.addLayer(gridLayer);
		gridLayer.bringToFront();
	}
}

function addMarker(latlng) {
	//create
	var marker = L.marker(latlng, {
			data: {
				id: markers.length > 0 ? markers[markers.length-1].options.data.id + 1 : 1,
				x: null,
				y: null,
				nearby: 0,
				score: 0
			}
		}
	);

	//store
	storeInGrid(marker);
	markers.push(marker);
	layers.overlays.Markers.addLayer(marker);
}

function removeMarker(marker) {
	var x = marker.options.data.x,
		y = marker.options.data.y;
	grid[x][y].splice(grid[x][y].indexOf(marker), 1);
	markers.splice(markers.indexOf(marker), 1);
	map.removeLayer(marker);
	computeScores();
}

//convert latlng into x/y corresponding to grid quadrant
function getGridCoords(latlng) {
	//https://stackoverflow.com/questions/22032270/how-to-retrieve-layerpoint-x-y-from-latitude-and-longitude-coordinates-using
	return map.project(latlng).divideBy(gridLayer.getTileSize().x).floor();
}

function storeInGrid(marker) {
	//compute tile x/y
	var coords = getGridCoords(marker.getLatLng()),
		x = coords.x,
		y = coords.y;

	//store x/y in marker's metadata
	marker.options.data.x = x;
	marker.options.data.y = y;

	//add to grid for fast lookups
	if (!grid[x]) grid[x] = [];
	if (!grid[x][y]) grid[x][y] = [];
	grid[x][y].push(marker);
}

//do computations to facilitate heatmap styling, and density score
function computeScores() {
	params.markerMax = 0;
	var x, y, dx, dy, nearby, score, distance;

	markers.forEach(function(marker) {
		x = marker.options.data.x;
		y = marker.options.data.y;
		score = 0;
		nearby = 0;

		//loop markers in current and adjacent grid quadrants
		for (dx = -GUTTER_RADIUS; dx <= GUTTER_RADIUS; dx++) {
			for (dy = -GUTTER_RADIUS; dy <= GUTTER_RADIUS; dy++) {
				if (grid[x + dx] && grid[x + dx][y + dy]) { //check there are markers at target quadrant
					//track quadrant w/ highest number of markers re: heatmap styling
					if (grid[x + dx][y + dy].length > params.markerMax) {
						params.markerMax = grid[x + dx][y + dy].length;
					}

					//compute/track density score and nearby counts
					grid[x + dx][y + dy].forEach(function(target) { //jshint ignore:line
						if (target === marker) {
							return;
						}
						//similar to the gravitational force equation
						distance = marker.getLatLng().distanceTo(target.getLatLng());
						score += 1 / Math.pow(0.25 + (distance / params.cellLength), 2);
						nearby++;
					});
				}
			}
		}

		//record in marker metadata
		marker.options.data.nearby = nearby;
		marker.options.data.score = score;
	});

	//trigger redraw of grid (if applicable)
	if (gridLayer && map.hasLayer(gridLayer)) {
		gridLayer.redraw();
	}
}

//handle moving backwards/forwards thru the welcome modal wizard
function step(direction) {
	if (direction) { //back/next
		welcomeStep += direction;
	} else { //initial/reset
		welcomeStep = 1;
	}

	//hide all our associated elements
	$('[id^=welcome-step]').hide();

	//show associated div/buttons appropriate to our step #
	$('#welcome-step-' + welcomeStep).show();
	if (welcomeStep > 1) {
		$('#welcome-step-back').show();
	}
	if (welcomeStep == 3) {
		$('#welcome-step-go').show();
	} else {
		$('#welcome-step-next').show();
	}
}