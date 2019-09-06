var gulp = require('gulp'),
	clean = require('gulp-clean');

//tasks
gulp.task('clean', function () {
	return gulp.src(['./dist/*', '!./dist/img'], {read: false})
		.pipe(clean());
});
gulp.task('copy-src', function () {
	return gulp.src('./src/*')
		.pipe(gulp.dest('./dist/'));
});
gulp.task('copy-deps', function () {
	return gulp.src([
				'./node_modules/jquery/**/*',
				'./node_modules/bootstrap/**/*',
				'./node_modules/leaflet*/**/*',
				'./node_modules/lodash/**/*',
			], {
				base: './node_modules'
			})
		.pipe(gulp.dest('./dist/deps'));
});
gulp.task('copy-fa', function () { //since fontawesome makes a weird @-prefixed folder we want to get rid of
	return gulp.src('./node_modules/@fortawesome/fontawesome-free/**/*', {base: './node_modules/@fortawesome'})
		.pipe(gulp.dest('./dist/deps'));
});
gulp.task('watch', function() {
	gulp.watch('./src/**/*', gulp.series('copy-src'));
});

//series'
var build = gulp.series('clean', gulp.parallel('copy-src', 'copy-deps', 'copy-fa'));//, gulp.parallel());

//export tasks
exports.build = build;